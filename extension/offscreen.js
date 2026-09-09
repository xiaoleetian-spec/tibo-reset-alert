let context;
chrome.runtime.onMessage.addListener((message,sender,reply)=> {
  if(sender.id!==chrome.runtime.id || message.target!=='offscreen' || message.type!=='play-audio') return false;
  (async()=> {
    context ||= new AudioContext();
    await context.resume();
    if(context.state!=='running') throw new Error('声音未能启动，请检查浏览器与系统音量');
    for(let i=0;i<3;i++) {
      const oscillator=context.createOscillator(),gain=context.createGain();
      oscillator.type='sine';oscillator.frequency.value=i===1?1046:784;
      const start=context.currentTime+i*0.36;
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(0.18,start+0.025);gain.gain.exponentialRampToValueAtTime(0.001,start+0.26);
      oscillator.connect(gain).connect(context.destination);oscillator.start(start);oscillator.stop(start+0.28);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    }
    return {ok:true};
  })().then(reply).catch(e=>reply({ok:false,error:e.message}));return true;
});
