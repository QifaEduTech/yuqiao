// Legacy recordings remain private and deletable; local voice cloning is retired.
export class VoiceService {
  installed(){return false;}
  status(){return {available:false,ready:false,busy:false,retired:true,engine:'已切换千问',mode:'retired',trained:false,device:null,note:'本地个人音色已停用，当前统一使用千问音色。旧录音未上传。'};}
  async synthesize(){throw Object.assign(new Error('本地个人音色已停用，请使用千问音色。'),{status:410});}
  close(){}
}
