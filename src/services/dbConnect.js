const mongoose = require("mongoose");
const roomsModel = require("../models/room");

require("dotenv").config({ path: ".env" });

const connect = () => {
  try {
    mongoose.set("strictPopulate", false);
    
    // mongoose.set("debug", true);
    if (process.env.MONGO_URI == undefined) {
      return;
      throw new Error("MONGO_URI is not defined");
    }
    const options = {
      serverSelectionTimeoutMS: 30000,
    };
      mongoose
        .connect(process.env.MONGO_URI, options)
        .then(
          async (res) => {
            try { 
              require("../shared/jobs");
              console.log("Index on activeTime created successfully.");
            } catch (error) {
              console.error("Error creating index:", error);
            }
            console.log(`connected!`);
          },
          (err) => console.log(err)
        )
        .catch((err) => console.log(err));
  } catch (err) {
    console.log(err);
  }
};
module.exports = connect;
