"""Exit when the spawning service or the Windows venv launcher exits."""
import os,sys,threading,time
def link_parent(parent_id):
    parents={int(parent_id),os.getppid()}
    if sys.platform=='win32':
        import ctypes
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.WaitForMultipleObjects.argtypes=[wintypes.DWORD,ctypes.POINTER(wintypes.HANDLE),wintypes.BOOL,wintypes.DWORD];kernel.WaitForMultipleObjects.restype=wintypes.DWORD
        handles=[kernel.OpenProcess(0x00100000,False,pid) for pid in parents]
        if not all(handles):raise RuntimeError('Parent lifetime could not be verified')
        array=(wintypes.HANDLE*len(handles))(*handles)
        def wait():
            kernel.WaitForMultipleObjects(len(handles),array,False,0xffffffff);os._exit(2)
    else:
        def wait():
            while True:
                try:
                    for pid in parents:os.kill(pid,0)
                except ProcessLookupError:os._exit(2)
                time.sleep(.5)
    threading.Thread(target=wait,daemon=True).start()
