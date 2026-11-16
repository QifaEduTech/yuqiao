import React from 'react';
import {createRoot} from 'react-dom/client';
import TrainingPage from './TrainingPage';
import {AuthGate} from './AuthGate';
import './styles.css';
import './training.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="normal"><TrainingPage/></AuthGate></React.StrictMode>);
