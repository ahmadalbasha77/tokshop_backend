let Transactionreasons = {
  SENTTIP: "you have sent a tip",
  WITHDRAWREQUEST: "Withdraw Request -- Pending",
  NEWACCOUNTAWARD: "NEW account award",
  RECEIVEDTIP: "you have received a tip",
  PURCHASED: "you have purchased a product",
  PURCHASE: " product has been bought",
  UPGRADE: " you upgraded your account",
  UPGRADERENEWAL: " you have renewed your upgrade",
  REFERRAL: " your referral joined GistShop",
  REFUND: "you have been refunded for the order cancellation of ",
  REFUNDED: "you have refunded for the cancellation of the order of ",
  DEPOSIT: "you have successfully deposited GP ",
  
};

let DEFAULTS = {
  CUSTOMER_ADDRESS:  {
    name: "Customer Name",
    street1: "123 Main St",
    city: "San Francisco",
    state: "CA",
    zip: "94117",
    country: "US",
    phone: "1234567890",
    email: "dYk0i@example.com",
  },
  SELLER_ADDRESS:  {
    name: "Sender Name",
    street1: "123 Main St",
    city: "San Francisco",
    state: "CA",
    zip: "94117",
    country: "US",
    phone: "1234567890",
    email: "dYk0i@example.com",
  }
}
function mapDefaultToAddressShape(def) {
  return {
    name: def.name,
    addrress1: def.street1,   // note your model uses "addrress1"
    city: def.city,
    state: def.state,
    zipcode: def.zip,
    countryCode: def.country,
    phone: def.phone,
    email: def.email,
  };
}
module.exports = {
  Transactionreasons,DEFAULTS
};
