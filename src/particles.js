// GPU 粒子系统：全部状态驻留在 storage buffer 中，由 TSL compute shader 每帧推进。
// 物理模型 = 解析旋度噪声流场（无散度，像流体）+ 粘性拖拽 + 引力井 + 形状回归弹簧 + 低音径向爆炸。

import * as THREE from 'three/webgpu';
import {
	Fn, If, uniform, float, vec3, instancedArray, instanceIndex, hash, uv,
	sin, cos, sqrt, pow, floor, abs, max, mix, smoothstep, clamp, exp, length, normalize, PI2
} from 'three/tsl';

export const SHAPES = [ 'sphere', 'torus', 'galaxy', 'helix', 'cube', 'chaos' ];

export const PALETTES = {
	cyber: [ '#1a0a5e', '#00e5ff', '#ff2bd6' ],
	toxic: [ '#04200f', '#39ff14', '#e8ff3a' ],
	inferno: [ '#2a0004', '#ff3d00', '#ffd27a' ],
	vapor: [ '#12063a', '#8a5cff', '#ff9ad5' ],
	ice: [ '#020c24', '#3b8bff', '#d8f6ff' ]
};

export class ParticleSystem {

	constructor( count ) {

		this.count = count;

		this.u = {
			dt: uniform( 1 ), // 以 60fps 为 1 的时间缩放
			time: uniform( 0 ),
			gravity: uniform( 0.35 ),
			viscosity: uniform( 0.08 ),
			turbulence: uniform( 0.6 ),
			flowScale: uniform( 0.22 ),
			cohesion: uniform( 0.5 ),
			explosion: uniform( 1.0 ),
			kick: uniform( 0 ),
			bass: uniform( 0 ),
			mid: uniform( 0 ),
			high: uniform( 0 ),
			attractor: uniform( new THREE.Vector3() ),
			wellStrength: uniform( 0 ),
			shape: uniform( 0 ),
			spin: uniform( 0 ),
			tilt: uniform( 0 ),
			size: uniform( 0.045 ),
			brightness: uniform( 0.55 ),
			density: uniform( 1 ), // 按粒子数归一化的亮度补偿
			colA: uniform( new THREE.Color() ),
			colB: uniform( new THREE.Color() ),
			colC: uniform( new THREE.Color() )
		};

		this.u.density.value = THREE.MathUtils.clamp( Math.sqrt( ( 1 << 20 ) / count ), 0.7, 4 );

		this.positions = instancedArray( count, 'vec3' );
		this.velocities = instancedArray( count, 'vec3' );
		this.targets = instancedArray( count, 'vec3' );

		this.buildCompute();
		this.buildMesh();

	}

	buildCompute() {

		const { count, positions, velocities, targets, u } = this;

		// ---------- 形状目标点 ----------
		const shapeTarget = Fn( () => {

			// 注意：在 If 分支之前用 toVar() 求值。否则 TSL 只会在第一个用到它们的分支里生成计算代码，
			// 其他分支读到的是未赋值的变量（星系只剩一条旋臂、立方体塌缩等）。
			const i = float( instanceIndex ).toVar();
			const t = i.div( count ).toVar();
			const r1 = hash( instanceIndex ).toVar();
			const r2 = hash( instanceIndex.add( 7919 ) ).toVar();
			const r3 = hash( instanceIndex.add( 104729 ) ).toVar();
			const p = vec3( 0 ).toVar();

			If( u.shape.equal( 0 ), () => {

				// 斐波那契球壳 + 轻微厚度
				const y = float( 1 ).sub( t.mul( 2 ) );
				const rad = sqrt( max( float( 0 ), float( 1 ).sub( y.mul( y ) ) ) );
				const phi = i.mul( 2.399963 );
				p.assign( vec3( cos( phi ).mul( rad ), y, sin( phi ).mul( rad ) ).mul( r1.mul( 0.18 ).add( 0.82 ).mul( 6.5 ) ) );

			} ).ElseIf( u.shape.equal( 1 ), () => {

				// 圆环
				const a = r1.mul( PI2 );
				const b = r2.mul( PI2 );
				const tube = sqrt( r3 ).mul( 1.7 );
				const ring = cos( b ).mul( tube ).add( 5.2 );
				p.assign( vec3( cos( a ).mul( ring ), sin( b ).mul( tube ), sin( a ).mul( ring ) ) );

			} ).ElseIf( u.shape.equal( 2 ), () => {

				// 三旋臂星系
				const arm = floor( r1.mul( 3 ) );
				const radius = pow( r2, 1.6 ).mul( 10 ).add( 0.25 );
				const scatter = r3.sub( 0.5 ).mul( 0.9 ).div( radius.mul( 0.35 ).add( 0.6 ) );
				const ang = arm.mul( PI2.div( 3 ) ).add( radius.mul( 0.75 ) ).add( scatter );
				const r4 = hash( instanceIndex.add( 1299709 ) );
				const thick = r4.sub( 0.5 ).mul( exp( radius.mul( - 0.25 ) ).mul( 2.2 ).add( 0.25 ) );
				p.assign( vec3( cos( ang ).mul( radius ), thick, sin( ang ).mul( radius ) ) );

			} ).ElseIf( u.shape.equal( 3 ), () => {

				// DNA 双螺旋 + 碱基对横档
				const y = t.sub( 0.5 ).mul( 15 );
				const strand = floor( r1.mul( 2 ) );
				const ang = y.mul( 0.9 ).add( strand.mul( Math.PI ) );
				const isRung = r2.lessThan( 0.22 ).and( floor( y.mul( 2.2 ) ).mod( 2 ).equal( 0 ) );
				const rad = isRung.select( r3.mul( 2 ).sub( 1 ).mul( 2.6 ), r3.mul( 0.45 ).add( 2.6 ) );
				const jitter = vec3( hash( instanceIndex.add( 3 ) ), hash( instanceIndex.add( 5 ) ), hash( instanceIndex.add( 11 ) ) ).sub( 0.5 ).mul( 0.25 );
				p.assign( vec3( cos( ang ).mul( rad ), y, sin( ang ).mul( rad ) ).add( jitter ) );

			} ).ElseIf( u.shape.equal( 4 ), () => {

				// 空心立方体：将随机点投影到立方体表面
				const q = vec3( r1, r2, r3 ).mul( 2 ).sub( 1 );
				const m = max( abs( q.x ), max( abs( q.y ), abs( q.z ) ) );
				p.assign( q.div( m ).mul( 4.6 ) );

			} ).Else( () => {

				// 混沌：均匀体积云
				const dir = normalize( vec3( r1, r2, r3 ).sub( 0.5 ).add( 0.0001 ) );
				p.assign( dir.mul( pow( hash( instanceIndex.add( 17 ) ), 0.33 ).mul( 11 ) ) );

			} );

			return p;

		} );

		this.computeInit = Fn( () => {

			const target = shapeTarget();
			targets.element( instanceIndex ).assign( target );
			const r = vec3( hash( instanceIndex.add( 31 ) ), hash( instanceIndex.add( 37 ) ), hash( instanceIndex.add( 41 ) ) ).sub( 0.5 );
			positions.element( instanceIndex ).assign( r.mul( 30 ) );
			velocities.element( instanceIndex ).assign( vec3( 0 ) );

		} )().compute( count ).setName( 'Init Particles' );

		this.computeTargets = Fn( () => {

			targets.element( instanceIndex ).assign( shapeTarget() );

		} )().compute( count ).setName( 'Shape Targets' );

		// ---------- 解析旋度噪声：ψ = (sin(a·y+t)cos(b·z), sin(a·z+t)cos(b·x), sin(a·x+t)cos(b·y))，取 ∇×ψ ----------
		const curl = Fn( ( [ P, phase ] ) => {

			const a = float( 1.0 );
			const b = float( 1.37 );
			const aP = P.mul( a ).add( phase );
			const sA = sin( aP );
			const cA = cos( aP );
			const sB = sin( P.mul( b ) );
			const cB = cos( P.mul( b ) );
			return sA.mul( sB.yzx ).mul( b ).add( cA.zxy.mul( cB ).mul( a ) ).negate();

		} );

		// ---------- 每帧更新 ----------
		this.computeUpdate = Fn( () => {

			const position = positions.element( instanceIndex );
			const velocity = velocities.element( instanceIndex );
			const pos = position.toVar();
			const vel = velocity.toVar();
			const dt = u.dt;
			const rnd = hash( instanceIndex.add( 911 ) );

			// 1) 流场：两个八度，低音会加速流动与扰动
			const P = pos.mul( u.flowScale );
			const tPhase = vec3( u.time.mul( 0.21 ), u.time.mul( 0.17 ).add( 1.3 ), u.time.mul( 0.23 ).add( 2.7 ) );
			const flow = curl( P, tPhase ).add( curl( P.mul( 2.3 ).add( 5.1 ), tPhase.mul( 1.7 ) ).mul( 0.45 ) );
			const flowVel = flow.mul( u.turbulence.mul( u.bass.mul( 1.8 ).add( u.mid.mul( 0.6 ) ).add( 1 ) ) ).mul( 0.06 );

			// 2) 流体粘度：速度向局部流场速度靠拢（粘度越高 = 越"稠"，越被流体裹挟）
			vel.assign( mix( vel, flowVel, clamp( u.viscosity.mul( dt ), 0, 1 ) ) );

			// 3) 引力：朝向吸引点（默认中心，按住 Shift 时为鼠标），软化避免奇点
			const toA = u.attractor.sub( pos );
			const dist = length( toA ).add( 0.0001 );
			const g = u.gravity.add( u.wellStrength );
			vel.addAssign( toA.div( dist ).mul( g.mul( 0.004 ) ).mul( smoothstep( 0, 2.5, dist ) ).mul( dt ) );

			// 4) 重组：弹簧拉向目标形状（先绕 Y 自转，再按形态倾斜），低音使形状"呼吸"
			const tgt = targets.element( instanceIndex );
			const cs = cos( u.spin );
			const sn = sin( u.spin );
			const ry = vec3( tgt.x.mul( cs ).sub( tgt.z.mul( sn ) ), tgt.y, tgt.x.mul( sn ).add( tgt.z.mul( cs ) ) );
			const ct = cos( u.tilt );
			const st = sin( u.tilt );
			const rot = vec3( ry.x, ry.y.mul( ct ).sub( ry.z.mul( st ) ), ry.y.mul( st ).add( ry.z.mul( ct ) ) );
			const breathe = rot.mul( u.bass.mul( 0.35 ).add( 1 ) );
			vel.addAssign( breathe.sub( pos ).mul( u.cohesion.mul( 0.012 ) ).mul( dt ) );

			// 5) 低音炸裂：径向冲击 + 随机切向扰动
			const dir = normalize( pos.add( vec3( rnd.sub( 0.5 ), hash( instanceIndex.add( 13 ) ).sub( 0.5 ), hash( instanceIndex.add( 19 ) ).sub( 0.5 ) ).mul( 0.6 ) ) );
			const burst = u.kick.mul( u.explosion ).mul( rnd.mul( 1.2 ).add( 0.4 ) ).mul( 0.11 );
			vel.addAssign( dir.mul( burst ).add( flow.mul( burst.mul( 0.35 ) ) ).mul( dt ) );

			// 6) 基础阻尼，限制最大速度
			vel.mulAssign( pow( float( 0.985 ), dt ) );
			const sp = length( vel );
			If( sp.greaterThan( 2.5 ), () => {

				vel.mulAssign( float( 2.5 ).div( sp ) );

			} );

			pos.addAssign( vel.mul( dt ) );

			// 7) 软边界：飞出太远时被拉回
			const r = length( pos );
			If( r.greaterThan( 45 ), () => {

				vel.mulAssign( 0.5 );
				pos.mulAssign( float( 45 ).div( r ) );

			} );

			position.assign( pos );
			velocity.assign( vel );

		} )().compute( count ).setName( 'Update Particles' );

	}

	buildMesh() {

		const { positions, velocities, u } = this;

		const material = new THREE.SpriteNodeMaterial( {
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		} );

		const vel = velocities.toAttribute();
		const pos = positions.toAttribute();
		const rnd = hash( instanceIndex.add( 59 ) );

		material.positionNode = pos;
		material.scaleNode = u.size.mul( rnd.mul( 0.9 ).add( 0.55 ) ).mul( u.high.mul( 0.6 ).add( 1 ) );

		material.colorNode = Fn( () => {

			const speed = length( vel );
			const heat = clamp( speed.mul( 3.0 ).add( u.bass.mul( 0.35 ) ).add( rnd.mul( 0.25 ) ), 0, 1.4 );
			// 静止时：主色 + 自下而上渐变到强调色；速度越快越"烫"
			const gradient = smoothstep( - 7, 7, pos.y ).mul( 0.55 ).add( rnd.mul( 0.15 ) );
			const c1 = mix( mix( u.colA, u.colB, smoothstep( 0.0, 0.3, heat ) ), u.colC, gradient );
			const c2 = mix( c1, u.colC, smoothstep( 0.4, 1.0, heat ) );
			const hot = mix( c2, vec3( 1 ), smoothstep( 1.0, 1.4, heat ).mul( 0.6 ) );
			return hot.mul( u.brightness.mul( u.density ) ).mul( heat.mul( 0.6 ).add( 0.55 ) );

		} )();

		// 柔和圆点
		const d = length( uv().sub( 0.5 ) ).mul( 2 );
		material.opacityNode = pow( max( float( 0 ), float( 1 ).sub( d ) ), 1.6 );

		const sprite = new THREE.Sprite( material );
		sprite.count = this.count;
		sprite.frustumCulled = false;
		this.mesh = sprite;
		this.material = material;

	}

	// 各形态的展示倾角（星系 / 圆环倾斜，否则从正面看只是一条线）
	setShape( index ) {

		this.u.shape.value = index;
		this.u.tilt.value = [ 0, 0.45, 0.55, 0, 0.3, 0 ][ index ] || 0;

	}

	setPalette( name ) {

		const p = PALETTES[ name ] || PALETTES.cyber;
		this.u.colA.value.set( p[ 0 ] );
		this.u.colB.value.set( p[ 1 ] );
		this.u.colC.value.set( p[ 2 ] );

	}

}
