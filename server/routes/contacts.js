import express from "express";
import Contact from "../models/Contact.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    res.json(await Contact.find().sort({ name: 1 }).lean());
  } catch (error) {
    res.status(500).json({ message: "Could not load contacts.", detail: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const contact = await Contact.create(req.body);
    res.status(201).json(contact);
  } catch (error) {
    res.status(400).json({ message: "Could not create contact.", detail: error.message });
  }
});

router.get("/:contactId", async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.contactId).lean();
    if (!contact) return res.status(404).json({ message: "Contact not found." });
    res.json(contact);
  } catch (error) {
    res.status(400).json({ message: "Invalid contact id.", detail: error.message });
  }
});

export default router;
