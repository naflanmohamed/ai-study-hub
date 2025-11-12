import React, { useState, useEffect, useContext, createContext } from 'react';

//  Firebase SDK Imports
import { initializeApp } from "firebase/app";
import { 
    getAuth, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut,
    getIdToken
} from "firebase/auth";
import { 
    getFirestore, 
    doc, 
    setDoc,
    onSnapshot 
} from "firebase/firestore";

// FIREBASE CONFIG HERE
const firebaseConfig = {
  apiKey: "AIzaSyD2Z-4HEVQucqrGy3HT2qo4zVkmpqLn4yo",
  authDomain: "ai-study-hub-9eed8.firebaseapp.com",
  projectId: "ai-study-hub-9eed8",
  storageBucket: "ai-study-hub-9eed8.firebasestorage.app",
  messagingSenderId: "299430608985",
  appId: "1:299430608985:web:2e3092afaafcb988a2f148"
};


// Initialize Firebase 
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

//  Constants 
const PREMIUM_WORD_LIMIT = 500;
const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:3001/api';

//  1. Authentication Context 
// This will provide user data and auth functions to our entire app.
// This is the "React" way to handle global state like "who is logged in".

const AuthContext = createContext();

export const useAuth = () => {
    return useContext(AuthContext);
};

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [isPremium, setIsPremium] = useState(false);
    const [loading, setLoading] = useState(true); // Is auth state still loading?

    // This listener runs once when the app loads and handles all auth logic
    useEffect(() => {
        let firestoreListener = null;

        const authListener = onAuthStateChanged(auth, (user) => {
            // First, clean up any old database listener
            if (firestoreListener) {
                firestoreListener();
                firestoreListener = null;
            }

            if (user) {
                // User is signed in
                setCurrentUser(user);

                // Now, listen for real-time changes to their premium status
                const userDocRef = doc(db, "users", user.uid);
                firestoreListener = onSnapshot(userDocRef, (doc) => {
                    if (doc.exists()) {
                        const userData = doc.data();
                        setIsPremium(userData.isPremium === true);
                    } else {
                        // This case should be rare, but we'll create a doc just in case
                        createUserDocument(user, false);
                        setIsPremium(false);
                    }
                    setLoading(false); // Auth is ready
                }, (error) => {
                    console.error("Error listening to user document:", error);
                    setLoading(false);
                });

            } else {
                // User is signed out
                setCurrentUser(null);
                setIsPremium(false);
                setLoading(false); // Auth is ready
            }
        });

        // Cleanup function for both listeners
        return () => {
            authListener();
            if (firestoreListener) {
                firestoreListener();
            }
        };
    }, []);

    //  Auth Functions (Sign up, Login, Logout) 

    // Helper to create the user's document in Firestore
    const createUserDocument = async (user, premiumStatus) => {
        const userDocRef = doc(db, "users", user.uid);
        await setDoc(userDocRef, {
            email: user.email,
            isPremium: premiumStatus,
            created: new Date()
        });
    };

    const handleSignup = async (email, password) => {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Create their database entry as a free user
        await createUserDocument(userCredential.user, false);
        // onAuthStateChanged will handle the rest
    };

    const handleLogin = async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged will handle the rest
    };

    const handleLogout = async () => {
        await signOut(auth);
    };

    //  Backend API Functions (Payments & AI) 

    const redirectToCheckout = async () => {
        if (!currentUser) throw new Error("Must be logged in to upgrade.");

        const token = await currentUser.getIdToken();
        const response = await fetch(`${BACKEND_API_URL}/create-checkout-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to create checkout session.");
        window.location.href = data.url;
    };

    const callBackendAPI = async (userQuery, systemInstruction, additionalData = {}) => {
        if (!currentUser) throw new Error("You must be logged in to do that.");
        
        const token = await currentUser.getIdToken();
        const payload = {
            userQuery,
            systemInstruction,
            ...additionalData
        };

        const response = await fetch(`${BACKEND_API_URL}/generate`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(`${response.status}: ${result.error || `HTTP error! status: ${response.status}`}`);
        }
        if (result.text) {
            return result.text;
        }
        throw new Error("Received an empty response from the server.");
    };

    // The "value" is what all child components will have access to
    const value = {
        currentUser,
        isPremium,
        loading,
        handleSignup,
        handleLogin,
        handleLogout,
        redirectToCheckout,
        callBackendAPI
    };

    // We don't render the app until we've checked the auth state
    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};


//  2. Main App Component 
// This is the root of our application

export default function App() {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
}

// We use an "AppContent" component so it can access the `useAuth` hook
function AppContent() {
    const { loading } = useAuth();
    const [authModalOpen, setAuthModalOpen] = useState(false);
    const [premiumModalOpen, setPremiumModalOpen] = useState(false);
    const [paymentMessage, setPaymentMessage] = useState(null);

    // Check for payment success/cancel messages in URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('payment') === 'success') {
            setPaymentMessage({ type: 'success', title: 'Payment Successful!', body: 'Welcome to Premium! Your features are now unlocked.' });
        }
        if (params.get('payment') === 'cancel') {
            setPaymentMessage({ type: 'warning', title: 'Payment Canceled', body: 'Your payment process was canceled. You are still on the free plan.' });
        }
        // Clear the URL parameters
        if (params.has('payment')) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, []);

    // Show a full-page loader while Firebase is initializing
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <LoadingSpinner size="large" />
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <Header setAuthModalOpen={setAuthModalOpen} />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
                
                {/* Payment Status Message */}
                {paymentMessage && (
                    <PaymentStatusMessage 
                        type={paymentMessage.type}
                        title={paymentMessage.title}
                        body={paymentMessage.body}
                    />
                )}

                <MainContent 
                    setAuthModalOpen={setAuthModalOpen}
                    setPremiumModalOpen={setPremiumModalOpen}
                />
            </main>
            
            <AuthModal 
                isOpen={authModalOpen} 
                setIsOpen={setAuthModalOpen} 
            />
            
            <PremiumModal 
                isOpen={premiumModalOpen} 
                setIsOpen={setPremiumModalOpen} 
            />
        </div>
    );
}

//  3. Child Components 

function Header({ setAuthModalOpen }) {
    const { currentUser, isPremium, handleLogout } = useAuth();

    return (
        <header className="bg-white shadow-sm">
            <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    <div className="flex-shrink-0 flex items-center">
                        <svg className="h-8 w-auto text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.523 5.754 18 7.5 18s3.332.523 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.523 18.246 18 16.5 18c-1.747 0-3.332.523-4.5 1.253" />
                        </svg>
                        <span className="ml-2 text-xl font-bold text-gray-900">AI Study Hub</span>
                    </div>
                    <div className="hidden md:flex md:items-center md:space-x-4">
                        <a href="#" className="text-gray-500 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">Pricing</a>
                        
                        {currentUser ? (
                            <div className="flex items-center space-x-4">
                                {isPremium && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        Premium
                                    </span>
                                )}
                                <span className="text-sm font-medium text-gray-700">{currentUser.email}</span>
                                <button onClick={handleLogout} className="text-gray-500 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">Log Out</button>
                            </div>
                        ) : (
                            <button onClick={() => setAuthModalOpen(true)} className="text-gray-500 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">Login</button>
                        )}
                        
                        {!isPremium && (
                            <button onClick={() => setAuthModalOpen(true)} className="ml-4 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
                                Upgrade
                            </button>
                        )}
                    </div>
                </div>
            </nav>
        </header>
    );
}

function MainContent({ setAuthModalOpen, setPremiumModalOpen }) {
    const { isPremium } = useAuth();

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2 bg-white rounded-lg shadow-lg overflow-hidden">
                <SummarizerAndHelper 
                    setAuthModalOpen={setAuthModalOpen}
                    setPremiumModalOpen={setPremiumModalOpen}
                />
            </div>
            
            {!isPremium && (
                <Sidebar 
                    setAuthModalOpen={setAuthModalOpen}
                />
            )}
        </div>
    );
}

function SummarizerAndHelper({ setAuthModalOpen, setPremiumModalOpen }) {
    const [activeTab, setActiveTab] = useState('summarizer');
    
    // State for Summarizer
    const [summaryInput, setSummaryInput] = useState('');
    const [summaryOutput, setSummaryOutput] = useState('');
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState('');
    const [wordCount, setWordCount] = useState(0);

    // State for Helper
    const [helperInput, setHelperInput] = useState('');
    const [helperOutput, setHelperOutput] = useState('');
    const [helperLoading, setHelperLoading] = useState(false);
    const [helperError, setHelperError] = useState('');
    
    const { currentUser, isPremium, callBackendAPI } = useAuth();

    // Word Count Effect
    useEffect(() => {
        const text = summaryInput.trim();
        const count = (text === "") ? 0 : text.split(/\s+/).length;
        setWordCount(count);
    }, [summaryInput]);
    
    const handleSummarize = async () => {
        if (!summaryInput) {
            setSummaryError("Please paste some text to summarize.");
            return;
        }
        if (!currentUser) {
            setAuthModalOpen(true);
            return;
        }
        const isOverLimit = wordCount > PREMIUM_WORD_LIMIT;
        if (isOverLimit && !isPremium) {
            setPremiumModalOpen(true);
            return;
        }

        setSummaryLoading(true);
        setSummaryOutput('');
        setSummaryError('');

        const systemPrompt = "You are an expert academic summarizer. Your goal is to provide a concise, clear, and accurate summary of the provided text. Focus on the main ideas, key points, and overall argument. Use clear language. Respond only with the summary.";
        const userQuery = `Please summarize the following text:\n\n\n${summaryInput}\n`;

        try {
            const resultText = await callBackendAPI(userQuery, systemPrompt, { isOverLimit });
            setSummaryOutput(resultText);
        } catch (error) {
            if (error.message.includes("402")) {
                setPremiumModalOpen(true);
            } else {
                setSummaryError(`Error: ${error.message}`);
            }
        } finally {
            setSummaryLoading(false);
        }
    };

    const handleStudyHelp = async () => {
        if (!helperInput) {
            setHelperError("Please ask a question.");
            return;
        }
        if (!currentUser) {
            setAuthModalOpen(true);
            return;
        }

        setHelperLoading(true);
        setHelperOutput('');
        setHelperError('');

        const systemPrompt = "You are a friendly and knowledgeable study helper. Your goal is to answer the user's question clearly and concisely, as if you were tutoring them. Break down complex topics into simple steps. Respond only with the answer to the question.";
        
        try {
            const resultText = await callBackendAPI(helperInput, systemPrompt);
            setHelperOutput(resultText);
        } catch (error) {
            setHelperError(`Error: ${error.message}`);
        } finally {
            setHelperLoading(false);
        }
    };

    const wordCountColor = wordCount > PREMIUM_WORD_LIMIT && !isPremium ? 'text-red-600 font-medium' : 'text-gray-500';
    const summarizerLabel = isPremium ? "Paste your notes here (Premium - Unlimited Words):" : "Paste your notes here (500-word limit for free users):";

    return (
        <div>
            {/* Tabs */}
            <div className="border-b border-gray-200">
                <nav className="-mb-px flex" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('summarizer')}
                        className={`w-1/2 py-4 px-1 text-center border-b-2 font-medium text-sm ${activeTab === 'summarizer' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                    >
                        AI Summarizer
                    </button>
                    <button
                        onClick={() => setActiveTab('helper')}
                        className={`w-1/2 py-4 px-1 text-center border-b-2 font-medium text-sm ${activeTab === 'helper' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                    >
                        AI Study Helper
                    </button>
                </nav>
            </div>

            {/* Summarizer Panel */}
            {activeTab === 'summarizer' && (
                <div className="p-6 md:p-8 space-y-6">
                    <div>
                        <label htmlFor="summarizer-input" className="block text-sm font-medium text-gray-700">{summarizerLabel}</label>
                        <textarea 
                            id="summarizer-input" 
                            rows="12" 
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" 
                            placeholder="Start typing or paste your text..."
                            value={summaryInput}
                            onChange={(e) => setSummaryInput(e.target.value)}
                        />
                        <p id="word-count" className={`mt-1 text-sm ${wordCountColor}`}>Word count: {wordCount}</p>
                    </div>
                    <button id="summarize-button" onClick={handleSummarize} disabled={summaryLoading} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300">
                        {summaryLoading ? <LoadingSpinner /> : (
                            <svg className="h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                            </svg>
                        )}
                        {summaryLoading ? "Summarizing..." : "Summarize"}
                    </button>
                    <div id="summarizer-output-container" className="space-y-2">
                        <h3 className="text-lg font-medium text-gray-900">Summary:</h3>
                        {summaryError && <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">{summaryError}</div>}
                        <div id="summarizer-output" className="p-4 bg-gray-50 rounded-md border border-gray-200 min-h-[100px] text-gray-800 whitespace-pre-wrap">
                            {summaryOutput}
                        </div>
                    </div>
                </div>
            )}

            {/* Study Helper Panel */}
            {activeTab === 'helper' && (
                <div className="p-6 md:p-8 space-y-6">
                    <div>
                        <label htmlFor="helper-input" className="block text-sm font-medium text-gray-700">Ask a study question:</label>
                        <input 
                            type="text" 
                            id="helper-input" 
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" 
                            placeholder="e.g., 'Explain the Pythagorean theorem'"
                            value={helperInput}
                            onChange={(e) => setHelperInput(e.target.value)}
                        />
                    </div>
                    <button id="helper-button" onClick={handleStudyHelp} disabled={helperLoading} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300">
                        {helperLoading ? <LoadingSpinner /> : (
                            <svg className="h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 01-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 013.09-3.09L12 5.25l.813 2.846a4.5 4.5 0 013.09 3.09L18.75 12l-2.846.813a4.5 4.5 0 01-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18.75 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L22.5 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.624L16.5 21.75l-.398-1.126a3.375 3.375 0 00-2.456-2.456L12.5 17.25l1.126-.398a3.375 3.375 0 002.456-2.456L16.5 13.5l.398 1.126a3.375 3.375 0 002.456 2.456L20.25 18l-1.126.398a3.375 3.375 0 00-2.456 2.456z" />
                            </svg>
                        )}
                        {helperLoading ? "Thinking..." : "Ask AI Helper"}
                    </button>
                    <div id="helper-output-container" className="space-y-2">
                        <h3 className="text-lg font-medium text-gray-900">Answer:</h3>
                        {helperError && <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">{helperError}</div>}
                        <div id="helper-output" className="p-4 bg-gray-50 rounded-md border border-gray-200 min-h-[100px] text-gray-800 whitespace-pre-wrap">
                            {helperOutput}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


function Sidebar({ setAuthModalOpen }) {
    const { currentUser, redirectToCheckout } = useAuth();
    const [isRedirecting, setIsRedirecting] = useState(false);

    const handleUpgradeClick = async () => {
        if (!currentUser) {
            setAuthModalOpen(true);
            return;
        }
        setIsRedirecting(true);
        try {
            await redirectToCheckout();
        } catch (error) {
            console.error("Failed to redirect to checkout", error);
            setIsRedirecting(false);
            // You could show an error message here
        }
    };

    return (
        <div className="space-y-8">
            {/* Premium Ad Card */}
            <div className="bg-white rounded-lg shadow-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900">Go Premium!</h3>
                <p className="mt-2 text-sm text-gray-600">Unlock unlimited summaries, an ad-free experience, and advanced study tools.</p>
                <button 
                    onClick={handleUpgradeClick}
                    disabled={isRedirecting}
                    className="mt-6 w-full inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300"
                >
                    {isRedirecting ? "Redirecting..." : "Upgrade Now"}
                </button>
            </div>

            {/* Ad Placeholder */}
            {/* <div className="bg-gray-200 rounded-lg p-6 h-64 flex items-center justify-center text-gray-500">
                <span className="text-center">Advertisement<br />(Placeholder for Ads)</span>
            </div> */}

            <div className="bg-white rounded-lg shadow-lg p-6 text-sm text-gray-600">
                <h4 className="text-sm font-semibold text-gray-900">Developed By: <a href="https://www.linkedin.com/in/naflan-mohamed" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Naflan Mohamed</a></h4>
                
            </div>
        </div>
    );
}

//  4. Modal Components 

function AuthModal({ isOpen, setIsOpen }) {
    const { handleLogin, handleSignup } = useAuth();
    const [isLoginTab, setIsLoginTab] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            if (isLoginTab) {
                await handleLogin(email, password);
            } else {
                await handleSignup(email, password);
            }
            setIsOpen(false); // Close modal on success
            setEmail('');
            setPassword('');
        } catch (err) {
            // Map Firebase errors to user-friendly messages
            let message = "An unknown error occurred. Please try again.";
            switch (err.code) {
                case "auth/wrong-password": message = "Incorrect password. Please try again."; break;
                case "auth/user-not-found": message = "No account found with this email. Please sign up."; break;
                case "auth/email-already-in-use": message = "This email is already in use. Please login."; break;
                case "auth/weak-password": message = "Your password must be at least 6 characters long."; break;
                case "auth/invalid-email": message = "Please enter a valid email address."; break;
            }
            setError(message);
        }
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-10 overflow-y-auto" aria-labelledby="auth-modal-title" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                <div onClick={() => setIsOpen(false)} className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true"></div>
                <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full">
                    <div className="bg-white px-4 pt-5 pb-4 sm:p-6">
                        <div className="border-b border-gray-200">
                            <nav className="-mb-px flex" aria-label="Tabs">
                                <button onClick={() => setIsLoginTab(true)} className={`w-1/2 py-4 px-1 text-center border-b-2 font-medium text-sm ${isLoginTab ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Login</button>
                                <button onClick={() => setIsLoginTab(false)} className={`w-1/2 py-4 px-1 text-center border-b-2 font-medium text-sm ${!isLoginTab ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Sign Up</button>
                            </nav>
                        </div>
                        {error && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>}
                        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email address</label>
                                <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="you@example.com" />
                            </div>
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                                <input type="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="••••••••" />
                            </div>
                            <button type="submit" className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700">
                                {isLoginTab ? "Login" : "Create Account"}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PremiumModal({ isOpen, setIsOpen }) {
    const { redirectToCheckout } = useAuth();
    const [isRedirecting, setIsRedirecting] =useState(false);

    const handleUpgrade = async () => {
        setIsRedirecting(true);
        try {
            await redirectToCheckout();
        } catch (error) {
            console.error("Failed to redirect", error);
            setIsRedirecting(false);
            // You could show an error in the modal
        }
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-10 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true"></div>
                <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                    <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                        <div className="sm:flex sm:items-start">
                            <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 sm:mx-0 sm:h-10 sm:w-10">
                                <svg className="h-6 w-6 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V9m0 6l.01.01M12 15a1 1 0 100-2 1 1 0 000 2zM12 3a9 9 0 100 18 9 9 0 000-18z" />
                                </svg>
                            </div>
                            <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">Premium Feature Locked</h3>
                                <p className="text-sm text-gray-500">
                                    This feature is for premium users only. Please upgrade your plan to unlock unlimited summaries, ad-free browsing, and more.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                        <button 
                            type="button" 
                            onClick={handleUpgrade}
                            disabled={isRedirecting}
                            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-indigo-300"
                        >
                            {isRedirecting ? "Redirecting..." : "Upgrade Now"}
                        </button>
                        <button 
                            type="button" 
                            onClick={() => setIsOpen(false)}
                            className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

//  5. Utility Components 

function LoadingSpinner({ size = 'small' }) {
    const sizeClasses = size === 'large' ? 'w-12 h-12' : 'w-5 h-5';
    return (
        <div 
            className={`spinner ${sizeClasses} border-4 ${size === 'large' ? 'border-gray-200 border-t-indigo-600' : 'border-white border-t-transparent'}`} 
            style={{ 
                animation: 'spin 1s linear infinite',
                borderRadius: '50%',
                ...(size === 'small' ? { 
                    borderTopColor: 'transparent',
                    borderRightColor: 'white',
                    borderBottomColor: 'white',
                    borderLeftColor: 'white'
                } : {})
            }}
        ></div>
    );
}

function PaymentStatusMessage({ type, title, body }) {
    const colors = {
        success: {
            bg: 'bg-green-50',
            title: 'text-green-800',
            body: 'text-green-700'
        },
        warning: {
            bg: 'bg-yellow-50',
            title: 'text-yellow-800',
            body: 'text-yellow-700'
        }
    };
    const color = colors[type] || colors['warning'];

    return (
        <div className={`rounded-md ${color.bg} p-4 mb-4`}>
            <h3 className={`text-sm font-medium ${color.title}`}>{title}</h3>
            <p className={`mt-2 text-sm ${color.body}`}>{body}</p>
        </div>
    );
}