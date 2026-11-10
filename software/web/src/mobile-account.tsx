import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileAccount from './MobileAccount';
import './styles.css';
import './mobile.css';
import './offline.css';
const native=new URLSearchParams(location.search).get('native')==='1';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><div className="mobile-shell account-portal"><header className="mobile-top"><a className="text-button" href={native?'yuqiao-account://close':'/android-offline.html?tab=me'}>← 返回语桥</a><span>账号服务</span></header><main className="mobile-content"><MobileAccount/></main></div></React.StrictMode>);
