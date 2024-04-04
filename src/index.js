// require('dotenv').config({})
import dotenv from 'dotenv'
import connectdb from "./db/index.js";
import { app } from './app.js'

dotenv.config({
    path: './env'
})
connectdb()
    .then(() => {
        app.on("error", (error) => {
            console.log("ERROR : ", error);
            throw error;
        })
        app.listen(process.env.PORT || 3000, () => {
            console.log(`Server is running at port : ${process.env.PORT}`);
        });
    })
    .catch((error) => {
        console.log("MongoDB connection failed!!!", error);
    })






/*
import { DB_NAME } from "./constants"
import mongoose from "mongoose";
import express from "express";


const app = express();

(async () => {
    try {
        await mongoose.connect(`${process.env.DATABASE_URL}/${DB_NAME}`)

        app.on("error", (error) => {
            console.log("ERROR:", error);
            throw error;
        })

        app.listen(process.env.PORT, () => {
            console.log(`App is listening on port : ${process.env.PORT}`);
        })

    } catch (error) {
        console.log("ERROR : ", error);
        throw error;
    }
})()
*/