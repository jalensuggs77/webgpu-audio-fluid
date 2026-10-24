import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { ParticleSystem, SHAPES } from './particles.js';
import { createPostFX } from './postfx.js';
import { AudioEngine } from './audio.js';
import { createUI, loadSettings } from './ui.js';

const settings = loadSettings();
const hasWebGPU = !! navigator.gpu;

function pickCount() {

	// ?n= 可指定任意数量（16K ~ 4M），面板上的预设只是常用档位
	const q = parseInt( new URLSearchParams( location.search ).get( 'n' ), 10 );
	if ( q > 0 ) return THREE.MathUtils.clamp( q, 1 << 14, 1 << 22 );
	// WebGL2 回退时默认降到 262K，保证流畅
	return hasWebGPU ? 1 << 20 : 1 << 18;

}

function formatCount( n ) {

	return n >= 1 << 20 ? ( n / ( 1 << 20 ) ).toFixed( n % ( 1 << 20 ) ? 1 : 0 ) + 'M' : Math.round( n / 1024 ) + 'K';

}

function fatal( title, err ) {

	const el = document.getElementById( 'fatal' );
	el.hidden = false;
	el.innerHTML = `<h2>${title}</h2><p>请使用最新版 Chrome / Edge（WebGPU），或开启浏览器硬件加速后重试。</p><code></code>`;
	el.querySelector( 'code' ).textContent = String( err && err.message || err );
	console.error( err );

}

async function main() {

	const count = pickCount();
	const container = document.getElementById( 'stage' );

	// ---------- 渲染器 ----------
	const renderer = new THREE.WebGPURenderer( { antialias: false, powerPreference: 'high-performance' } );
	renderer.setPixelRatio( Math.min( window.devicePixelRatio, 1.75 ) );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.1;
	container.appendChild( renderer.domElement );
	await renderer.init();

	const isWebGPU = !! renderer.backend.isWebGPUBackend;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x020208 );

	const camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 0.1, 400 );
	camera.position.set( 0, 6, 24 );

	const controls = new OrbitControls( camera, renderer.domElement );
	controls.enableDamping = true;
	controls.dampingFactor = 0.06;
	controls.minDistance = 4;
	controls.maxDistance = 120;
	controls.autoRotateSpeed = 0.35;
	controls.autoRotate = settings.autoRotate;

	// ---------- 粒子 ----------
	const ps = new ParticleSystem( count );
	ps.setPalette( settings.palette );
	scene.add( ps.mesh );

	const u = ps.u;
	ps.setShape( settings.shape );
	renderer.compute( ps.computeInit );

	// ---------- 后期：拖尾 + 霓虹辉光 + 暗角 ----------
	const { pipeline, bloomPass, trailDamp } = createPostFX( renderer, scene, camera, settings );

	// ---------- 音频 ----------
	const audio = new AudioEngine();
	audio.sensitivity = settings.sensitivity;

	let kick = 0;
	let flash = 0;
	let strongBeats = 0;

	const setShape = ( i ) => {

		settings.shape = i;
		ps.setShape( i );
		renderer.compute( ps.computeTargets );
		ui.setShape( i );

	};

	audio.onBeat = ( strength ) => {

		kick = Math.max( kick, strength );
		flash = Math.max( flash, strength );
		ui.flashBeat();

		// 重低音积累到一定次数：炸裂后重组成下一个形态
		if ( settings.autoMorph && strength > 0.7 && ++ strongBeats >= 8 ) {

			strongBeats = 0;
			kick = 1.6;
			setShape( ( settings.shape + 1 ) % ( SHAPES.length - 1 ) ); // 自动循环跳过"混沌"

		}

	};

	// ---------- 面板 ----------
	const applySetting = ( key, v ) => {

		switch ( key ) {

			case 'gravity': u.gravity.value = v; break;
			case 'viscosity': u.viscosity.value = v; break;
			case 'turbulence': u.turbulence.value = v; break;
			case 'cohesion': u.cohesion.value = v; break;
			case 'explosion': u.explosion.value = v; break;
			case 'sensitivity': audio.sensitivity = v; break;
			case 'glow': break; // 每帧随低音调制
			case 'bloomRadius': bloomPass.radius.value = v; break;
			case 'trails': trailDamp.value = v; break;
			case 'size': u.size.value = v; break;
			case 'brightness': u.brightness.value = v; break;
			case 'palette': ps.setPalette( v ); break;
			case 'shape': setShape( v ); kick = Math.max( kick, 0.9 ); break;
			case 'autoRotate': controls.autoRotate = v; break;

		}

	};

	const ui = createUI( {
		settings,
		count,
		handlers: {
			onSetting: applySetting,
			async onAudio( kind, file ) {

				try {

					if ( kind === 'stop' ) {

						audio.stop();
						ui.setAudioState( 'none', '已停止' );

					} else if ( kind === 'mic' ) {

						ui.setAudioState( 'mic', '请求麦克风权限…' );
						await audio.useMic();
						ui.setAudioState( 'mic', '● 麦克风实时输入', 'live' );

					} else if ( kind === 'file' ) {

						await audio.useFile( file );
						ui.setAudioState( 'file', '♪ ' + file.name, 'live' );

					} else if ( kind === 'demo' ) {

						await audio.useDemo();
						ui.setAudioState( 'demo', '✦ 内置合成节拍 · 124 BPM', 'live' );

					}

				} catch ( err ) {

					console.error( err );
					audio.stop();
					ui.setAudioState( 'none', '音频错误：' + ( err.message || err.name ), 'error' );

				}

			}
		}
	} );

	for ( const key of Object.keys( settings ) ) if ( key !== 'shape' ) applySetting( key, settings[ key ] );

	ui.setStats( {
		count: formatCount( count ),
		backend: isWebGPU ? 'WebGPU' : 'WebGL2',
		fallback: ! isWebGPU
	} );

	if ( ! isWebGPU ) console.warn( '[CyberFluid] 当前浏览器不支持 WebGPU，已回退到 WebGL2 后端。' );

	// ---------- 交互：Shift + 鼠标 = 引力井；空格 = 手动炸裂 ----------
	const pointer = new THREE.Vector2();
	const raycaster = new THREE.Raycaster();
	const plane = new THREE.Plane();
	const hit = new THREE.Vector3();
	let wellActive = false;
	let shiftDown = false;

	renderer.domElement.addEventListener( 'pointermove', ( e ) => {

		pointer.set( ( e.clientX / window.innerWidth ) * 2 - 1, - ( e.clientY / window.innerHeight ) * 2 + 1 );
		wellActive = shiftDown || e.shiftKey;

	} );
	renderer.domElement.addEventListener( 'pointerleave', () => { wellActive = false; } );

	window.addEventListener( 'keydown', ( e ) => {

		if ( e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox' ) return;
		if ( e.key === 'Shift' ) { shiftDown = true; wellActive = true; }
		if ( e.code === 'Space' ) { e.preventDefault(); kick = 1.2; flash = 1; ui.flashBeat(); }
		if ( e.key === 'h' || e.key === 'H' ) ui.toggleHidden();

	} );
	window.addEventListener( 'keyup', ( e ) => {

		if ( e.key === 'Shift' ) { shiftDown = false; wellActive = false; }

	} );
	window.addEventListener( 'blur', () => { shiftDown = false; wellActive = false; } );

	// ---------- 尺寸 ----------
	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

	// ---------- 主循环 ----------
	const timer = new THREE.Timer();
	timer.connect( document );
	let fpsAccum = 0;
	let fpsFrames = 0;
	let meterTick = 0;

	renderer.setAnimationLoop( () => {

		timer.update();
		const rawDelta = timer.getDelta();
		const delta = Math.min( rawDelta, 1 / 20 );
		const now = performance.now();

		audio.update( now );

		// 音频驱动 uniform
		u.dt.value = delta * 60;
		u.time.value = timer.getElapsed();
		u.bass.value = audio.bass;
		u.mid.value = audio.mid;
		u.high.value = audio.high;
		u.kick.value = kick;
		u.spin.value += delta * ( 0.08 + audio.bass * 0.5 );
		kick *= Math.exp( - delta * 7 );
		flash *= Math.exp( - delta * 5 );

		bloomPass.strength.value = settings.glow * ( 1 + audio.bass * 0.9 + flash * 0.8 );

		// 引力井：把鼠标投影到过原点、朝向镜头的平面
		if ( wellActive ) {

			raycaster.setFromCamera( pointer, camera );
			camera.getWorldDirection( hit );
			plane.setFromNormalAndCoplanarPoint( hit, controls.target );
			if ( raycaster.ray.intersectPlane( plane, hit ) ) u.attractor.value.lerp( hit, 0.35 );
			u.wellStrength.value += ( 2.2 - u.wellStrength.value ) * 0.2;

		} else {

			u.attractor.value.lerp( controls.target, 0.08 );
			u.wellStrength.value *= 0.85;

		}

		controls.update( delta );
		renderer.compute( ps.computeUpdate );
		pipeline.render();

		// 统计 / 电平（降低 DOM 更新频率）
		fpsAccum += rawDelta;
		fpsFrames ++;
		if ( fpsAccum >= 0.5 ) {

			ui.setStats( { fps: Math.round( fpsFrames / fpsAccum ) } );
			fpsAccum = 0;
			fpsFrames = 0;

		}

		if ( ( meterTick ++ & 1 ) === 0 ) ui.updateMeters( audio );

	} );

	// 调试 / 自动化测试钩子
	window.__cyberfluid = { renderer, ps, audio, settings, setShape, kick: () => { kick = 1.2; } };

}

main().catch( ( err ) => fatal( '初始化失败', err ) );
