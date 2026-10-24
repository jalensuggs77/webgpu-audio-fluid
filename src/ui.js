// 毛玻璃控制面板：生成滑块 / 调色板 / 形态与数量选择，并把改动回传给主循环。

import { PALETTES, SHAPES } from './particles.js';

const STORAGE_KEY = 'cyberfluid.settings.v1';

export const DEFAULTS = {
	gravity: 0.35,
	viscosity: 0.08,
	turbulence: 0.6,
	cohesion: 0.5,
	explosion: 1.0,
	sensitivity: 1.35,
	glow: 1.0,
	bloomRadius: 0.4,
	trails: 0.8,
	size: 0.045,
	brightness: 0.55,
	palette: 'cyber',
	shape: 0,
	autoMorph: true,
	autoRotate: true
};

const PHYSICS_SLIDERS = [
	{ key: 'gravity', name: '引力', en: 'GRAVITY', min: - 1, max: 2, step: 0.01 },
	{ key: 'viscosity', name: '流体粘度', en: 'VISCOSITY', min: 0, max: 0.4, step: 0.005, fmt: ( v ) => v.toFixed( 3 ) },
	{ key: 'turbulence', name: '湍流强度', en: 'TURBULENCE', min: 0, max: 2, step: 0.01 },
	{ key: 'cohesion', name: '重组力', en: 'COHESION', min: 0, max: 2, step: 0.01 },
	{ key: 'explosion', name: '炸裂力度', en: 'BLAST', min: 0, max: 3, step: 0.01 },
	{ key: 'sensitivity', name: '低音阈值', en: 'BASS GATE', min: 1.05, max: 2.5, step: 0.01, fmt: ( v ) => '×' + v.toFixed( 2 ) }
];

const VISUAL_SLIDERS = [
	{ key: 'glow', name: '霓虹辉光', en: 'GLOW', min: 0, max: 3, step: 0.01 },
	{ key: 'bloomRadius', name: '辉光半径', en: 'RADIUS', min: 0, max: 1, step: 0.01 },
	{ key: 'trails', name: '流光拖尾', en: 'TRAILS', min: 0, max: 0.97, step: 0.01 },
	{ key: 'brightness', name: '粒子亮度', en: 'INTENSITY', min: 0.05, max: 2, step: 0.01 },
	{ key: 'size', name: '粒子尺寸', en: 'SIZE', min: 0.01, max: 0.15, step: 0.001, fmt: ( v ) => v.toFixed( 3 ) }
];

const SHAPE_LABELS = {
	sphere: '球体', torus: '圆环', galaxy: '星系', helix: '双螺旋', cube: '立方', chaos: '混沌'
};

export const COUNTS = [
	{ n: 1 << 18, label: '262K' },
	{ n: 1 << 19, label: '524K' },
	{ n: 1 << 20, label: '1M' },
	{ n: 1 << 21, label: '2M' }
];

export function loadSettings() {

	let saved = {};
	try { saved = JSON.parse( localStorage.getItem( STORAGE_KEY ) ) || {}; } catch { /* 隐私模式等 */ }
	return { ...DEFAULTS, ...saved };

}

function saveSettings( s ) {

	try { localStorage.setItem( STORAGE_KEY, JSON.stringify( s ) ); } catch { /* 忽略 */ }

}

const $ = ( sel ) => document.querySelector( sel );

export function createUI( { settings, count, handlers } ) {

	let saveTimer = 0;
	const changed = ( key ) => {

		handlers.onSetting( key, settings[ key ] );
		clearTimeout( saveTimer );
		saveTimer = setTimeout( () => saveSettings( settings ), 250 );

	};

	// ---------- 滑块 ----------
	const sliderEls = {};

	const buildSliders = ( container, defs ) => {

		for ( const def of defs ) {

			const fmt = def.fmt || ( ( v ) => v.toFixed( 2 ) );
			const wrap = document.createElement( 'div' );
			wrap.className = 'slider';
			wrap.innerHTML = `<div class="row"><span class="name">${def.name}<small>${def.en}</small></span><output></output></div>`;
			const input = document.createElement( 'input' );
			input.type = 'range';
			input.min = def.min; input.max = def.max; input.step = def.step;
			input.setAttribute( 'aria-label', def.name );
			const out = wrap.querySelector( 'output' );

			const paint = () => {

				const v = parseFloat( input.value );
				out.textContent = fmt( v );
				input.style.setProperty( '--p', ( ( v - def.min ) / ( def.max - def.min ) * 100 ) + '%' );

			};

			input.value = settings[ def.key ];
			paint();
			input.addEventListener( 'input', () => {

				settings[ def.key ] = parseFloat( input.value );
				paint();
				changed( def.key );

			} );
			input.addEventListener( 'dblclick', () => {

				input.value = DEFAULTS[ def.key ];
				input.dispatchEvent( new Event( 'input' ) );

			} );

			wrap.appendChild( input );
			container.appendChild( wrap );
			sliderEls[ def.key ] = input;

		}

	};

	buildSliders( $( '#sliders-physics' ), PHYSICS_SLIDERS );
	buildSliders( $( '#sliders-visual' ), VISUAL_SLIDERS );

	// ---------- 调色板 ----------
	const palWrap = $( '#palettes' );
	for ( const [ name, cols ] of Object.entries( PALETTES ) ) {

		const sw = document.createElement( 'button' );
		sw.className = 'swatch';
		sw.title = name;
		sw.setAttribute( 'aria-label', '配色 ' + name );
		sw.style.background = `linear-gradient(90deg, ${cols[ 0 ]}, ${cols[ 1 ]}, ${cols[ 2 ]})`;
		sw.style.setProperty( '--glow', cols[ 1 ] );
		sw.dataset.palette = name;
		sw.addEventListener( 'click', () => {

			settings.palette = name;
			palWrap.querySelectorAll( '.swatch' ).forEach( ( el ) => el.classList.toggle( 'active', el === sw ) );
			changed( 'palette' );

		} );
		if ( name === settings.palette ) sw.classList.add( 'active' );
		palWrap.appendChild( sw );

	}

	// ---------- 形态 ----------
	const shapeWrap = $( '#shapes' );
	const shapeChips = SHAPES.map( ( name, i ) => {

		const chip = document.createElement( 'button' );
		chip.className = 'chip';
		chip.textContent = SHAPE_LABELS[ name ];
		chip.addEventListener( 'click', () => {

			settings.shape = i;
			changed( 'shape' );

		} );
		shapeWrap.appendChild( chip );
		return chip;

	} );

	const setShape = ( i ) => shapeChips.forEach( ( c, j ) => c.classList.toggle( 'active', i === j ) );
	setShape( settings.shape );

	for ( const [ id, key ] of [ [ '#auto-morph', 'autoMorph' ], [ '#auto-rotate', 'autoRotate' ] ] ) {

		const el = $( id );
		el.checked = settings[ key ];
		el.addEventListener( 'change', () => {

			settings[ key ] = el.checked;
			changed( key );

		} );

	}

	// ---------- 粒子数量 ----------
	const countWrap = $( '#counts' );
	for ( const c of COUNTS ) {

		const chip = document.createElement( 'button' );
		chip.className = 'chip';
		chip.textContent = c.label;
		if ( c.n === count ) chip.classList.add( 'active' );
		chip.addEventListener( 'click', () => {

			if ( c.n === count ) return;
			saveSettings( settings );
			const url = new URL( location.href );
			url.searchParams.set( 'n', c.n );
			location.href = url.toString();

		} );
		countWrap.appendChild( chip );

	}

	// ---------- 音频源 ----------
	const audioBtns = document.querySelectorAll( '[data-audio]' );
	const fileInput = $( '#file-input' );
	const status = $( '#audio-status' );

	audioBtns.forEach( ( btn ) => btn.addEventListener( 'click', () => {

		const kind = btn.dataset.audio;
		if ( kind === 'file' ) fileInput.click();
		else handlers.onAudio( kind );

	} ) );

	fileInput.addEventListener( 'change', () => {

		if ( fileInput.files[ 0 ] ) handlers.onAudio( 'file', fileInput.files[ 0 ] );
		fileInput.value = '';

	} );

	// 拖放音频
	let dragDepth = 0;
	window.addEventListener( 'dragenter', ( e ) => {

		e.preventDefault();
		dragDepth ++;
		document.body.classList.add( 'dragging' );

	} );
	window.addEventListener( 'dragleave', () => {

		if ( -- dragDepth <= 0 ) {

			dragDepth = 0;
			document.body.classList.remove( 'dragging' );

		}

	} );
	window.addEventListener( 'dragover', ( e ) => e.preventDefault() );
	window.addEventListener( 'drop', ( e ) => {

		e.preventDefault();
		dragDepth = 0;
		document.body.classList.remove( 'dragging' );
		const file = [ ...e.dataTransfer.files ].find( ( f ) => f.type.startsWith( 'audio' ) || /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i.test( f.name ) );
		if ( file ) handlers.onAudio( 'file', file );

	} );

	// ---------- 面板收起 / 隐藏 ----------
	const togglePanel = ( force ) => document.body.classList.toggle( 'panel-collapsed', force );
	$( '#btn-collapse' ).addEventListener( 'click', () => togglePanel( true ) );
	$( '#btn-expand' ).addEventListener( 'click', () => togglePanel( false ) );
	if ( window.innerWidth <= 720 ) togglePanel( true );

	// ---------- 电平表 / 频谱 ----------
	const spectrum = $( '#spectrum' );
	const sctx = spectrum.getContext( '2d' );
	const mBass = $( '#m-bass' );
	const mMid = $( '#m-mid' );
	const mHigh = $( '#m-high' );
	const led = $( '#beat-led' );
	let ledTimer = 0;
	let grad = null;

	const drawSpectrum = ( freq ) => {

		const w = spectrum.width;
		const h = spectrum.height;
		sctx.clearRect( 0, 0, w, h );
		if ( ! freq ) return;

		if ( ! grad ) {

			grad = sctx.createLinearGradient( 0, 0, w, 0 );
			grad.addColorStop( 0, '#ff2bd6' );
			grad.addColorStop( 0.35, '#8a5cff' );
			grad.addColorStop( 1, '#00e5ff' );

		}

		// 对数频率轴，突出低频
		const bars = 72;
		const bw = w / bars;
		const n = freq.length;
		sctx.fillStyle = grad;
		sctx.shadowColor = '#00e5ff';
		sctx.shadowBlur = 8;
		for ( let i = 0; i < bars; i ++ ) {

			const a = Math.floor( Math.pow( n * 0.6, i / bars ) );
			const b = Math.max( a + 1, Math.floor( Math.pow( n * 0.6, ( i + 1 ) / bars ) ) );
			let v = 0;
			for ( let k = a; k < b; k ++ ) v = Math.max( v, freq[ k ] );
			const bh = Math.max( 1.5, ( v / 255 ) ** 1.6 * h );
			sctx.fillRect( i * bw + 1, h - bh, bw - 2, bh );

		}

	};

	return {

		setShape,

		setAudioState( mode, text, cls = '' ) {

			audioBtns.forEach( ( b ) => b.classList.toggle( 'active', b.dataset.audio === mode ) );
			status.textContent = text;
			status.className = 'status ' + cls;

		},

		updateMeters( audio ) {

			mBass.style.width = Math.min( 100, audio.bass * 100 ) + '%';
			mMid.style.width = Math.min( 100, audio.mid * 100 ) + '%';
			mHigh.style.width = Math.min( 100, audio.high * 100 ) + '%';
			drawSpectrum( audio.mode === 'none' ? null : audio.freqData );

		},

		flashBeat() {

			led.classList.add( 'on' );
			clearTimeout( ledTimer );
			ledTimer = setTimeout( () => led.classList.remove( 'on' ), 90 );

		},

		setStats( { fps, count: n, backend, fallback } ) {

			if ( fps !== undefined ) $( '#stat-fps' ).textContent = fps;
			if ( n !== undefined ) $( '#stat-count' ).textContent = n;
			if ( backend !== undefined ) {

				const el = $( '#stat-backend' );
				el.textContent = backend;
				el.classList.toggle( 'fallback', !! fallback );

			}

		},

		togglePanel,

		toggleHidden() {

			document.body.classList.toggle( 'ui-hidden' );

		}

	};

}
