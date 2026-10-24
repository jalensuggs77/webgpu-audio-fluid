// 后期链：流光拖尾（AfterImage）→ 霓虹辉光（Bloom）→ 暗角。

import * as THREE from 'three/webgpu';
import { pass, uniform, screenUV, float, smoothstep, length } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';

export function createPostFX( renderer, scene, camera, { glow, bloomRadius, trails } ) {

	const trailDamp = uniform( trails );
	const scenePass = pass( scene, camera );
	const sceneColor = scenePass.getTextureNode( 'output' );
	const trailNode = afterImage( sceneColor, trailDamp );
	const bloomPass = bloom( trailNode, glow, bloomRadius, 0.12 );
	const vignette = float( 1 ).sub( smoothstep( 0.35, 0.95, length( screenUV.sub( 0.5 ).mul( 1.25 ) ) ).mul( 0.75 ) );

	const pipeline = new THREE.RenderPipeline( renderer );
	pipeline.outputNode = trailNode.add( bloomPass ).mul( vignette );

	return { pipeline, bloomPass, trailDamp };

}
