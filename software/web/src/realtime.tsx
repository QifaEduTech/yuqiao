import React from 'react';
import {createRoot} from 'react-dom/client';
import RealtimePage from './RealtimePage';
import {AuthGate} from './AuthGate';
import './styles.css';
import './realtime.css';
const hospitalDemo = new URLSearchParams(window.location.search).get('demo') === 'hospital';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="camera"><RealtimePage hospitalDemo={hospitalDemo}/></AuthGate></React.StrictMode>);
