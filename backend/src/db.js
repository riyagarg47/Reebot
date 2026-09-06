import mongoose from "mongoose";

export async function connectDb(url) {
  await mongoose.connect(url);
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}
