document.querySelector('#enter').addEventListener('click',()=>{location.href='app/android-offline.html';});
document.addEventListener('plusready',()=>{plus.key.addEventListener('backbutton',()=>plus.runtime.quit());});
