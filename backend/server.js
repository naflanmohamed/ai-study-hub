import express from 'express'
import cors from 'cors'
import 'dotenv/config' // Loads .env file
import axios from 'axios'
import Stripe from 'stripe'
import admin from 'firebase-admin'

// --- IMPORTANT: Get your Firebase Admin SDK JSON ---
// 1. Go to Firebase Console -> Project Settings -> Service Accounts
// 2. Click "Generate new private key"
// 3. Rename the downloaded JSON file to "firebase-admin-sdk.json"
// 4. Place it in this "backend" folder.
import serviceAccount from './firebase-admin-sdk.json' with { type: 'json' }


// --- Initialize App ---
const app = express()
const port = process.env.PORT || 3001

// --- Initialize Firebase Admin ---
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})
const db = admin.firestore() // Get Firestore instance

// --- Initialize Stripe ---
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// --- Constants ---
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025'
const geminiApiKey = process.env.GEMINI_API_KEY
const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`

const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500'

// --- Middleware ---
// We need a special raw body parser for the Stripe webhook
// It must come BEFORE app.use(express.json())
app.post(
  '/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
)

app.use(cors()) // Enable CORS for all other routes
app.use(express.json()) // Enable JSON parsing for other routes

// --- NEW: Firebase Auth Middleware ---
// This middleware checks if a user is authenticated
// before allowing them to access an endpoint.
const checkAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send('Unauthorized: No token provided')
  }

  const idToken = authHeader.split('Bearer ')[1]
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken)
    // Add user info to the request object for other handlers to use
    req.user = decodedToken
    next() // User is authenticated, proceed to the next handler
  } catch (error) {
    console.error('Error verifying auth token:', error)
    return res.status(401).send('Unauthorized: Invalid token')
  }
}

// --- API Endpoints ---

// 1. /api/generate (For AI)
// We add the 'checkAuth' middleware to protect this endpoint
app.post('/api/generate', checkAuth, async (req, res) => {
  const { userQuery, systemInstruction } = req.body
  const userId = req.user.uid // We get this from the checkAuth middleware

  // --- NEW: Check Premium Status ---
  // Now we check if the user is premium before calling the AI
  let isPremium = false
  try {
    const userDoc = await db.collection('users').doc(userId).get()
    if (userDoc.exists && userDoc.data().isPremium === true) {
      isPremium = true
    }
  } catch (error) {
    console.error('Error reading from Firestore:', error)
    return res.status(500).json({ error: 'Could not verify user status.' })
  }

  // --- This is our business logic ---
  // Let's pretend the word count is passed from the frontend
  // In a real app, you might do the word count here to be more secure
  const isOverLimit = req.body.isOverLimit || false

  if (isOverLimit && !isPremium) {
    return res
      .status(402)
      .json({ error: 'Payment Required: Word limit exceeded. Please upgrade.' })
  }
  // --- End of business logic ---

  const payload = {
    contents: [{ parts: [{ text: userQuery }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
  }

  try {
    const response = await axios.post(geminiApiUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    })

    const candidate = response.data.candidates?.[0]
    if (candidate && candidate.content?.parts?.[0]?.text) {
      res.json({ text: candidate.content.parts[0].text })
    } else {
      const blockReason = response.data.promptFeedback?.blockReason
      if (blockReason) {
        return res
          .status(500)
          .json({ error: `Request was blocked by Google: ${blockReason}` })
      }
      res
        .status(500)
        .json({ error: 'Received an invalid or empty response from the AI.' })
    }
  } catch (error) {
    console.error(
      'Error calling Gemini API:',
      error.response ? error.response.data : error.message
    )
    res.status(500).json({ error: 'Failed to generate content.' })
  }
})

// 2. NEW: /api/create-checkout-session (For Payments)
// We also protect this with 'checkAuth'
app.post('/api/create-checkout-session', checkAuth, async (req, res) => {
  const userId = req.user.uid
  const userEmail = req.user.email

  try {
    // We pass the user's Firebase UID to Stripe's metadata
    // This is CRITICAL for the webhook to know who paid.
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: userEmail, // Pre-fill email
      line_items: [
        {
          price: STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      // We pass the Firebase UID here
      metadata: {
        firebaseUID: userId,
      },
      success_url: `${FRONTEND_URL}/index.html?payment=success`,
      cancel_url: `${FRONTEND_URL}/index.html?payment=cancel`,
    })

    // Send the session URL back to the frontend
    res.json({ url: session.url })
  } catch (error) {
    console.error('Error creating Stripe session:', error)
    res.status(500).json({ error: 'Failed to create payment session.' })
  }
})

// 3. NEW: /api/stripe-webhook (For Stripe to talk to us)
// This function is called by the 'app.post' at the top
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature']
  let event

  try {
    // Verify the event came from Stripe
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error(`Webhook signature verification failed:`, err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object

    // --- This is the most important part ---
    // Get the Firebase UID we stored in metadata
    const firebaseUID = session.metadata.firebaseUID
    if (!firebaseUID) {
      console.error('Webhook Error: No firebaseUID in session metadata!')
      return res.status(400).send('Error: Missing user ID in session.')
    }

    try {
      // Find the user in our Firestore database
      const userRef = db.collection('users').doc(firebaseUID)

      // Update their status to premium!
      await userRef.update({
        isPremium: true,
        stripeCustomerId: session.customer, // Store Stripe customer ID for managing subscription
      })

      console.log(`Successfully upgraded user ${firebaseUID} to premium.`)
    } catch (error) {
      console.error(`Failed to update user ${firebaseUID} in Firestore:`, error)
      return res.status(500).send('Failed to update user subscription status.')
    }
  }

  // Acknowledge receipt of the event
  res.json({ received: true })
}

// Start the server
app.listen(port, () => {
  console.log(`Backend server is running on http://localhost:${port}`)
})
