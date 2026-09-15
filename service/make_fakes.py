"""
Generate synthetic speech in bulk for the 'fake' training class.

Your classifier detects *synthesis*, not identity. So for training you do not
need voice cloning at all — you need a lot of neural TTS, ideally in the
languages and accents you will be demoing in. Cloning one clip at a time is
slow and buys you nothing here.

edge-tts uses Microsoft's neural voices. No GPU, no API key, no model
download. It does need internet, so run this before the hackathon.

    pip install edge-tts
    python make_fakes.py --n 60 --out data/fake

Add --hindi-only to skip English voices.
"""
import argparse
import asyncio
import random
import sys
from pathlib import Path

try:
    import edge_tts  # pyright: ignore[reportMissingImports]
except ImportError:
    print("pip install edge-tts")
    sys.exit(1)

# Voices grouped by language. A voice must be given text in its own script —
# sending Devanagari to a Tamil voice returns no audio, which is what the
# 'No audio was received' failures were.
VOICE_LINES = {
    "hi": (["hi-IN-MadhurNeural", "hi-IN-SwaraNeural"], [
        "बेटा मैं हॉस्पिटल में हूँ, एक्सीडेंट हो गया है, अभी पचास हज़ार भेज दो",
        "मम्मी को मत बताना, ये हमारे बीच की बात है, जल्दी पैसे भेजो",
        "सर मैं बैंक से बोल रहा हूँ, आपका खाता बंद हो जाएगा, ओटीपी बताइए",
        "फोन मत काटिए, मैं पुलिस स्टेशन से बोल रहा हूँ, मामला गंभीर है",
        "आपके बेटे को गिरफ्तार कर लिया गया है, अभी पैसे का इंतज़ाम कीजिए",
        "मुझे तुरंत पैसे चाहिए, बाद में सब समझा दूँगा, अभी ट्रांसफर करो",
        "आपका सिम कार्ड बंद हो रहा है, वेरिफिकेशन के लिए नंबर बताइए",
        "यह आखिरी मौका है, अभी नहीं भेजा तो बहुत देर हो जाएगी",
    ]),
    "mr": (["mr-IN-ManoharNeural", "mr-IN-AarohiNeural"], [
        "मी हॉस्पिटलमध्ये आहे, लवकर पैसे पाठवा, कोणाला सांगू नका",
        "मी बँकेतून बोलतोय, तुमचे खाते बंद होईल, ओटीपी सांगा",
        "फोन कट करू नका, हे प्रकरण खूप गंभीर आहे",
    ]),
    "ta": (["ta-IN-ValluvarNeural", "ta-IN-PallaviNeural"], [
        "நான் மருத்துவமனையில் இருக்கிறேன், உடனே பணம் அனுப்புங்கள்",
        "யாரிடமும் சொல்ல வேண்டாம், இது நமக்குள் மட்டும்",
        "நான் வங்கியிலிருந்து பேசுகிறேன், ஓடிபி சொல்லுங்கள்",
    ]),
    "te": (["te-IN-MohanNeural", "te-IN-ShrutiNeural"], [
        "నేను ఆసుపత్రిలో ఉన్నాను, వెంటనే డబ్బు పంపండి",
        "ఎవరికీ చెప్పవద్దు, ఇది మన మధ్య మాత్రమే",
        "నేను బ్యాంకు నుండి మాట్లాడుతున్నాను, ఓటీపీ చెప్పండి",
    ]),
    "bn": (["bn-IN-BashkarNeural", "bn-IN-TanishaaNeural"], [
        "আমি হাসপাতালে আছি, এখনই টাকা পাঠাও, কাউকে বোলো না",
        "আমি ব্যাংক থেকে বলছি, আপনার অ্যাকাউন্ট বন্ধ হয়ে যাবে",
        "ফোন কাটবেন না, বিষয়টি খুবই জরুরি",
    ]),
    "gu": (["gu-IN-NiranjanNeural", "gu-IN-DhwaniNeural"], [
        "હું હોસ્પિટલમાં છું, તરત જ પૈસા મોકલો, કોઈને કહેશો નહીં",
        "હું બેંકમાંથી બોલું છું, તમારું ખાતું બંધ થઈ જશે",
    ]),
    "kn": (["kn-IN-GaganNeural", "kn-IN-SapnaNeural"], [
        "ನಾನು ಆಸ್ಪತ್ರೆಯಲ್ಲಿದ್ದೇನೆ, ತಕ್ಷಣ ಹಣ ಕಳುಹಿಸಿ",
        "ಯಾರಿಗೂ ಹೇಳಬೇಡಿ, ಇದು ನಮ್ಮ ನಡುವೆ ಮಾತ್ರ",
    ]),
    "ml": (["ml-IN-MidhunNeural", "ml-IN-SobhanaNeural"], [
        "ഞാൻ ആശുപത്രിയിലാണ്, ഉടനെ പണം അയക്കൂ",
        "ആരോടും പറയരുത്, ഇത് നമ്മുടെ ഇടയിൽ മാത്രം",
    ]),
    "en": (["en-IN-PrabhatNeural", "en-IN-NeerjaNeural"], [
        "This is an urgent call regarding your account, please do not disconnect",
        "Transfer the amount immediately, I will explain everything afterwards",
        "Sir, your parcel has been seized by customs, pay the fine right now",
        "I am calling from the bank, share the OTP to stop this transaction",
        "Your son has been detained, arrange the money right now, tell no one",
        "This is your last chance, if you delay it will be too late",
    ]),
}

RATES = ["-10%", "-5%", "+0%", "+5%", "+10%"]
PITCHES = ["-5Hz", "+0Hz", "+5Hz"]


async def one(text, voice, rate, pitch, path):
    c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await c.save(str(path))


async def run(n, out, langs):
    out.mkdir(parents=True, exist_ok=True)
    made = failed = 0
    for i in range(n):
        lang = random.choice(langs)
        voices, lines = VOICE_LINES[lang]
        text = random.choice(lines)
        voice = random.choice(voices)
        rate, pitch = random.choice(RATES), random.choice(PITCHES)
        path = out / f"tts_{lang}_{i:03d}.mp3"
        try:
            await one(text, voice, rate, pitch, path)
            made += 1
            print(f"  [{made}/{n}] {voice}  {text[:34]}…")
        except Exception as e:
            failed += 1
            print(f"  [fail] {voice}: {e}", file=sys.stderr)
        await asyncio.sleep(0.25)          # be polite to a free service
    print(f"\n{made} written to {out}, {failed} failed")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--out", default="data/fake")
    ap.add_argument("--hindi-only", action="store_true",
                    help="Hindi and Marathi only")
    a = ap.parse_args()

    langs = ["hi", "mr"] if a.hindi_only else list(VOICE_LINES)
    n_voices = sum(len(VOICE_LINES[l][0]) for l in langs)
    print(f"Generating {a.n} clips · {len(langs)} languages · {n_voices} voices\n")
    asyncio.run(run(a.n, Path(a.out), langs))
    print("\nNext:")
    print("  1. Play some of these through a speaker into your demo laptop's")
    print("     mic and save those recordings to data/fake as well — that is")
    print("     what your demo channel actually sounds like.")
    print("  2. python train.py --data data --codec-aug")


if __name__ == "__main__":
    main()
