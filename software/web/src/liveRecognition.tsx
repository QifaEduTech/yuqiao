import React from 'react';
import {createRoot} from 'react-dom/client';
import {AuthGate} from './AuthGate';
import LiveRecognitionPage from './LiveRecognitionPage';
import './styles.css';
import './realtime.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AuthGate entry="camera"><LiveRecognitionPage/></AuthGate></React.StrictMode>
);
