import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

const connectdb = async () => {
    try {
        const connectionInstance = await mongoose.connect(`${process.env.DATABASE_URL}/${DB_NAME}`)
        console.log(`\nMongodb Instance: ${connectionInstance.connection.host}`);
    } catch (error) {
        console.log("Mongodb connection error: ", error);
        process.exit(1);
    }
}

export default connectdb;