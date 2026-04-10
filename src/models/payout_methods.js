const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const value = {
  type: String,
  required: [true, "This field is required"],
};

const payoutMethodSchema = new Schema(
  {
  	accountname: {
      type: String,
      default: "",
  	},
  	
  	type: {
      type: String,
      default: "",
  	},
  	accountno: {
      type: String,
      default: "",
  	},
  	 userid: 
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
  	primary: {
      type: Boolean,
      default: false,
  	},
  }
);
const users = model("payoutMethod", payoutMethodSchema);
module.exports = users;