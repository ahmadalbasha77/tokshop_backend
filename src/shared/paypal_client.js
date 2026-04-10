module.exports = {
  clientId: process.env.PAYPAL_CLIENT_ID,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  returnUrl: "https://yourbackend.com/paypal/success",
  cancelUrl: "https://yourbackend.com/paypal/cancel",
};
