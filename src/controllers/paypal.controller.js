

const CLIENT_ID = 'AU6JIIjI8FxeD1MONo8zSwhlbfJsiivAEq3SKT5FeTEp7Ow4STV6eR494Vg1nGa973eIMtEL6hAu0bey'; //process.env.PAYPAL_CLIENT_ID;
const SECRET = 'EEsW60AVW8XooSRSJLgRPj0LrunlKqfdayRFnvfwPqrtHcalBJ6xnQn7yv8I4pLyDJhKa5hbClzkTBG-'; //process.env.PAYPAL_SECRET;


exports.connectPaypal = async (req, res) => {
    // 1. Get OAuth access token (YOU ALREADY DID THIS RIGHT)
    const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64");

    const tokenRes = await fetch(
        "https://api-m.sandbox.paypal.com/v1/oauth2/token",
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
        }
    );

    const tokenData = await tokenRes.json();

    // 2. Create setup token
    const setupRes = await fetch(
        "https://api-m.sandbox.paypal.com/v3/vault/setup-tokens",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                payment_source: {
                    paypal: {
                        "usage_type": "MERCHANT",
                        experience_context: {
                            return_url: "myapp://paypal-success",
                            cancel_url: "myapp://paypal-cancel",
                        },
                    },
                },
            }),
        }
    );

    const setupData = await setupRes.json();
    console.log(setupData);

    // 3. Extract approval URL
    const approveUrl = setupData.links?.find(
        (l) => l.rel === "approve"
    )?.href;

    // 4. Send ONLY what Flutter needs
    res.json({
        setupToken: setupData.id,
        approvalUrl: approveUrl,
    });
};
exports.confirmPaypal = async (req, res) => {
    console.log(req.body);
    const { setupToken } = req.body;

    // 1. Get OAuth token again (server-side)
    const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64");

    const tokenRes = await fetch(
        "https://api-m.sandbox.paypal.com/v1/oauth2/token",
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
        }
    );

    const tokenData = await tokenRes.json();
    console.log(tokenData);

    // 2. THIS IS THE IMPORTANT CALL
    const paymentTokenRes = await fetch(
        "https://api-m.sandbox.paypal.com/v3/vault/payment-tokens",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                payment_source: {
                    paypal: {
                        setup_token: setupToken,
                        usage_type: "MERCHANT",
                    },
                },
            }),
        }
    );

    const paymentTokenData = await paymentTokenRes.json();
    console.log(paymentTokenData);

    // 🔥 THIS IS WHAT YOU SAVE
    /*
      paymentTokenData.id            -> chargeable token
      paymentTokenData.customer.id   -> PayPal customer
    */

    // SAVE TO DB HERE
    // user.paypalPaymentToken = paymentTokenData.id;

    res.json({
        paymentToken: paymentTokenData.id,
        customerId: paymentTokenData.customer?.id,
        status: paymentTokenData.status,
    });
};
