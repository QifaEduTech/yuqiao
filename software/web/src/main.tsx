import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import {AuthGate} from './AuthGate';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate entry="normal"><App /></AuthGate>
  </React.StrictMode>,
);
