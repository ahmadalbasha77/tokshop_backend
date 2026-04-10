const mongoose = require("mongoose");
var crypto = require("crypto");
// {
//       accountname: 'stripe',
//       type: 'bank',
//       accountno: 'acct_1QyuOeD0t7BUqp60',
//       userid: new ObjectId('67bcdd014882f3f79fb2a091'),
//       primary: true,
//       __v: 0
//     }
const BankSchema = mongoose.Schema({
  accountname: {
    type: String,
    required: true,
  },
  accountno: {
    type: String,
    required: true,
  },
  userid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
  },
  primary: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("bank", BankSchema);
