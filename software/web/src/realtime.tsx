import React from 'react';
import {createRoot} from 'react-dom/client';
import RealtimePage from './RealtimePage';
import {AuthGate} from './AuthGate';
import './styles.css';
import './realtime.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="camera"><RealtimePage/></AuthGate></React.StrictMode>);
