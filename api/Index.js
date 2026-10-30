const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

// Initialize Firebase Admin (Ensure your credentials are set via environment or service account)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        // databaseURL: "https://zoo420-default-rtdb.firebaseio.com" // Uncomment if Realtime DB is also needed
    });
}

const db = admin.firestore();
const app = express();

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// MIDDLEWARE: FIREBASE AUTHENTICATION
// ==========================================
const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Auth Error:', error.message);
        res.status(401).json({ error: 'Unauthorized: Authentication failed' });
    }
};

// ==========================================
// 1. CREATE RUPAYEX ORDER
// ==========================================
app.post('/wallet/createOrder', authenticateUser, async (req, res) => {
    try {
        const { amount } = req.body;
        const uid = req.user.uid;

        // Validate Amount (Minimum ₹100 as per common standards)
        if (!amount || isNaN(amount) || Number(amount) < 100) {
            return res.status(400).json({ error: 'Invalid amount. Minimum amount is ₹100' });
        }

        // Generate Unique Order ID
        const orderId = `ORD_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

        // Save Initial Transaction to Firestore (Status: PENDING)
        const txRef = db.collection('transactions').doc(orderId);
        await txRef.set({
            userId: uid,
            amount: Number(amount),
            status: 'PENDING',
            gateway: 'RUPAYEX',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Call Rupayex API to Create Order[span_0](start_span)[span_0](end_span)
        const rupayexParams = new URLSearchParams();
        rupayexParams.append('user_token', process.env.RUPAYEX_API_TOKEN);
        rupayexParams.append('amount', amount.toString());
        rupayexParams.append('order_id', orderId);
        rupayexParams.append('redirect_url', process.env.WEBHOOK_URL);

        const rupayexResponse = await axios.post(
            'https://rupayex.net/api/create-order',
            rupayexParams,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Api-Token': process.env.RUPAYEX_API_TOKEN
                }
            }
        );

        // Return the gateway response to frontend
        res.status(200).json({
            success: true,
            orderId: orderId,
            gatewayData: rupayexResponse.data
        });

    } catch (error) {
        console.error('Create Order Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

// ==========================================
// 2. RUPAYEX WEBHOOK & VERIFICATION
// ==========================================
app.post('/webhook/rupayex', async (req, res) => {
    try {
        const { order_id } = req.body;

        if (!order_id) {
            return res.status(400).send('Missing order_id');
        }

        // Server-to-Server Verification (Security: Never trust frontend or unverified webhook payload)
        const verifyUrl = `https://rupayex.net/api/order-status?user_token=${process.env.RUPAYEX_API_TOKEN}&order_id=${order_id}`;
        const verifyResponse = await axios.get(verifyUrl);
        const gatewayData = verifyResponse.data;[span_1](start_span)[span_1](end_span)

        const txRef = db.collection('transactions').doc(order_id);

        // Proceed ONLY if Rupayex server confirms payment is SUCCESS
        if (gatewayData.status === true && gatewayData.payment_status === 'SUCCESS') {[span_2](start_span)[span_2](end_span)
            
            // Use Firestore Transaction to prevent race conditions and duplicate credits
            await db.runTransaction(async (transaction) => {
                const txDoc = await transaction.get(txRef);
                
                if (!txDoc.exists) {
                    throw new Error('Transaction not found in database');
                }

                const txData = txDoc.data();

                // Idempotency: Credit ONLY if current status is strictly 'PENDING'
                if (txData.status !== 'PENDING') {
                    console.log(`Order ${order_id} is already processed (${txData.status}). Skipping.`);
                    return; 
                }

                // Verify amount matches exactly
                if (Number(txData.amount) !== Number(gatewayData.amount)) {[span_3](start_span)[span_3](end_span)
                    throw new Error('Amount mismatch detected');
                }

                // Get User Reference
                const userRef = db.collection('users').doc(txData.userId);

                // Update Transaction Status to SUCCESS
                transaction.update(txRef, {
                    status: 'SUCCESS',
                    utr: gatewayData.utr || req.body.utr || null,[span_4](start_span)[span_4](end_span)
                    processedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Credit Wallet Balance (Adds to rechargeBal as per your app logic)
                transaction.update(userRef, {
                    rechargeBal: admin.firestore.FieldValue.increment(Number(txData.amount))
                });
            });

            console.log(`Payment SUCCESS processed securely for Order: ${order_id}`);
        } else {
            // Update transaction to FAILED if gateway says it failed or pending
            await txRef.update({ 
                status: 'FAILED',
                gatewayStatus: gatewayData.payment_status || 'UNKNOWN'
            });
            console.log(`Payment FAILED/PENDING for Order: ${order_id}`);
        }

        // Always return 200 OK to acknowledge receipt to the gateway webhook sender
        res.status(200).send('OK');

    } catch (error) {
        console.error('Webhook Verification Error:', error.message);
        res.status(200).send('Webhook processed with internal error');
    }
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Esports Payment Backend running on port ${PORT}`);
});
                                                                           
