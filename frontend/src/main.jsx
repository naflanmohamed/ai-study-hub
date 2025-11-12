import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app.jsx' // <-- Import our new app.jsx
import './index.css' // <-- Import our new CSS

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)