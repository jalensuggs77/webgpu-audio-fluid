// Web Audio 引擎：麦克风 / 本地音频文件 / 内置合成节拍，输出低中高频能量与低音节拍事件。

const BANDS = {
	bass: [ 20, 140 ],
	mid: [ 140, 2000 ],
	high: [ 2000, 12000 ]
};

export class AudioEngine {

	constructor() {

		this.ctx = null;
		this.analyser = null;
		this.freqData = null;

		this.source = null; // 当前连接到 analyser 的节点
		this.mode = 'none'; // none | mic | file | demo
		this.micStream = null;
		this.mediaEl = null;
		this.demo = null;

		// 输出（0..1）
		this.bass = 0;
		this.mid = 0;
		this.high = 0;
		this.level = 0;

		// 节拍检测
		this.sensitivity = 1.35; // 当前低音需超过近期均值的倍数
		this.history = new Float32Array( 64 );
		this.historyIndex = 0;
		this.lastBeat = 0;
		this.beatCount = 0;
		this.onBeat = null; // ( strength ) => void

	}

	async ensureContext() {

		if ( ! this.ctx ) {

			this.ctx = new ( window.AudioContext || window.webkitAudioContext )();
			this.analyser = this.ctx.createAnalyser();
			this.analyser.fftSize = 2048;
			this.analyser.smoothingTimeConstant = 0.55;
			this.analyser.minDecibels = - 90;
			this.analyser.maxDecibels = - 15;
			this.freqData = new Uint8Array( this.analyser.frequencyBinCount );

		}

		if ( this.ctx.state === 'suspended' ) await this.ctx.resume();

	}

	stop() {

		if ( this.source ) {

			try { this.source.disconnect(); } catch { /* 已断开 */ }
			this.source = null;

		}

		if ( this.analyser ) {

			try { this.analyser.disconnect(); } catch { /* 已断开 */ }

		}

		if ( this.micStream ) {

			this.micStream.getTracks().forEach( ( t ) => t.stop() );
			this.micStream = null;

		}

		if ( this.mediaEl ) {

			this.mediaEl.pause();
			URL.revokeObjectURL( this.mediaEl.src );
			this.mediaEl = null;

		}

		if ( this.demo ) {

			this.demo.stop();
			this.demo = null;

		}

		this.mode = 'none';

	}

	async useMic() {

		await this.ensureContext();
		const stream = await navigator.mediaDevices.getUserMedia( {
			audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
		} );
		this.stop();
		this.micStream = stream;
		this.source = this.ctx.createMediaStreamSource( stream );
		this.source.connect( this.analyser ); // 不接扬声器，避免啸叫
		this.mode = 'mic';

	}

	async useFile( file ) {

		await this.ensureContext();
		this.stop();
		const el = new Audio();
		el.src = URL.createObjectURL( file );
		el.loop = true;
		el.crossOrigin = 'anonymous';
		this.mediaEl = el;
		this.source = this.ctx.createMediaElementSource( el );
		this.source.connect( this.analyser );
		this.analyser.connect( this.ctx.destination );
		this.mode = 'file';
		await el.play();

	}

	async useDemo() {

		await this.ensureContext();
		this.stop();
		this.demo = new DemoBeat( this.ctx );
		this.source = this.demo.output;
		this.source.connect( this.analyser );
		this.analyser.connect( this.ctx.destination );
		this.demo.start();
		this.mode = 'demo';

	}

	togglePause() {

		if ( this.mode === 'file' && this.mediaEl ) {

			if ( this.mediaEl.paused ) this.mediaEl.play(); else this.mediaEl.pause();
			return ! this.mediaEl.paused;

		}

		if ( this.ctx ) {

			if ( this.ctx.state === 'running' ) this.ctx.suspend(); else this.ctx.resume();
			return this.ctx.state !== 'running';

		}

		return false;

	}

	bandEnergy( [ lo, hi ] ) {

		const nyquist = this.ctx.sampleRate / 2;
		const n = this.freqData.length;
		const i0 = Math.max( 1, Math.floor( lo / nyquist * n ) );
		const i1 = Math.min( n - 1, Math.ceil( hi / nyquist * n ) );
		let sum = 0;
		for ( let i = i0; i <= i1; i ++ ) sum += this.freqData[ i ];
		return sum / ( ( i1 - i0 + 1 ) * 255 );

	}

	// 每帧调用；返回 true 表示本帧检测到低音节拍
	update( now ) {

		if ( this.mode === 'none' || ! this.analyser ) {

			this.bass *= 0.9; this.mid *= 0.9; this.high *= 0.9; this.level *= 0.9;
			return false;

		}

		this.analyser.getByteFrequencyData( this.freqData );

		const bass = this.bandEnergy( BANDS.bass );
		const mid = this.bandEnergy( BANDS.mid );
		const high = this.bandEnergy( BANDS.high );

		// 快攻慢放的包络
		const env = ( prev, v, up, down ) => v > prev ? prev + ( v - prev ) * up : prev + ( v - prev ) * down;
		this.bass = env( this.bass, bass, 0.7, 0.12 );
		this.mid = env( this.mid, mid, 0.6, 0.1 );
		this.high = env( this.high, high, 0.6, 0.1 );
		this.level = ( this.bass + this.mid + this.high ) / 3;

		// 基于能量通量的低音节拍检测
		let avg = 0;
		for ( let i = 0; i < this.history.length; i ++ ) avg += this.history[ i ];
		avg /= this.history.length;
		this.history[ this.historyIndex ] = bass;
		this.historyIndex = ( this.historyIndex + 1 ) % this.history.length;

		const isBeat = bass > 0.28 && bass > avg * this.sensitivity && now - this.lastBeat > 180;

		if ( isBeat ) {

			this.lastBeat = now;
			this.beatCount ++;
			const strength = Math.min( 1, ( bass - avg ) / Math.max( 0.08, 1 - avg ) * 1.6 + 0.35 );
			if ( this.onBeat ) this.onBeat( strength );

		}

		return isBeat;

	}

}

// 内置合成节拍：底鼓 + 锯齿贝斯 + 踩镲，无需任何音频文件即可体验
class DemoBeat {

	constructor( ctx ) {

		this.ctx = ctx;
		this.output = ctx.createGain();
		this.output.gain.value = 0.55;
		this.bpm = 124;
		this.step = 0;
		this.nextTime = 0;
		this.timer = null;

		const len = ctx.sampleRate * 0.5;
		this.noise = ctx.createBuffer( 1, len, ctx.sampleRate );
		const d = this.noise.getChannelData( 0 );
		for ( let i = 0; i < len; i ++ ) d[ i ] = Math.random() * 2 - 1;

		// 小调贝斯走向（半音偏移，基于 A1 = 55Hz）
		this.bassline = [ 0, 0, 12, 0, 3, 3, 15, 3, 5, 5, 17, 5, 7, 7, 10, 12 ];

	}

	start() {

		this.nextTime = this.ctx.currentTime + 0.05;
		this.timer = setInterval( () => this.schedule(), 25 );

	}

	stop() {

		clearInterval( this.timer );
		this.output.disconnect();

	}

	schedule() {

		const sixteenth = 60 / this.bpm / 4;

		while ( this.nextTime < this.ctx.currentTime + 0.12 ) {

			const s = this.step % 16;
			const bar = Math.floor( this.step / 16 ) % 4;
			if ( s % 4 === 0 ) this.kick( this.nextTime, bar === 3 && s === 12 ? 1.25 : 1 );
			if ( bar === 3 && s >= 13 ) this.kick( this.nextTime, 0.7 );
			if ( s % 2 === 1 ) this.hat( this.nextTime, s % 4 === 2 ? 0.25 : 0.12 );
			if ( s % 4 === 2 ) this.hat( this.nextTime, 0.3 );
			if ( s % 2 === 0 ) this.bassNote( this.nextTime, this.bassline[ ( s + bar * 4 ) % 16 ], sixteenth * 1.6 );

			this.nextTime += sixteenth;
			this.step ++;

		}

	}

	kick( t, amp ) {

		const ctx = this.ctx;
		const osc = ctx.createOscillator();
		const g = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.setValueAtTime( 150, t );
		osc.frequency.exponentialRampToValueAtTime( 42, t + 0.12 );
		g.gain.setValueAtTime( 0.0001, t );
		g.gain.exponentialRampToValueAtTime( amp, t + 0.004 );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + 0.45 );
		osc.connect( g ).connect( this.output );
		osc.start( t );
		osc.stop( t + 0.5 );

	}

	bassNote( t, semis, dur ) {

		const ctx = this.ctx;
		const osc = ctx.createOscillator();
		const filter = ctx.createBiquadFilter();
		const g = ctx.createGain();
		osc.type = 'sawtooth';
		osc.frequency.value = 55 * Math.pow( 2, semis / 12 );
		filter.type = 'lowpass';
		filter.Q.value = 8;
		filter.frequency.setValueAtTime( 900, t );
		filter.frequency.exponentialRampToValueAtTime( 140, t + dur );
		g.gain.setValueAtTime( 0.0001, t );
		g.gain.exponentialRampToValueAtTime( 0.22, t + 0.01 );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
		osc.connect( filter ).connect( g ).connect( this.output );
		osc.start( t );
		osc.stop( t + dur + 0.05 );

	}

	hat( t, amp ) {

		const ctx = this.ctx;
		const src = ctx.createBufferSource();
		const filter = ctx.createBiquadFilter();
		const g = ctx.createGain();
		src.buffer = this.noise;
		filter.type = 'highpass';
		filter.frequency.value = 7000;
		g.gain.setValueAtTime( amp, t );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + 0.05 );
		src.connect( filter ).connect( g ).connect( this.output );
		src.start( t );
		src.stop( t + 0.06 );

	}

}
