import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp';
import {AuthGate} from './AuthGate';
import './styles.css';
import './mobile.css';
import './training.css';
import './realtime.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="normal" mobile><MobileApp/></AuthGate></React.StrictMode>);
