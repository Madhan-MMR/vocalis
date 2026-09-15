import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    psNumber: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    organisation: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    theme: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

export default mongoose.model("Project", projectSchema);
