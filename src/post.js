// Post-processing: ambient occlusion, bloom, depth blur like in model photos, tone mapping, vignette, grain, outline on pointing.

import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, TiltShiftEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, NoiseEffect, BlendFunction, SMAAEffect, SMAAPreset, OutlineEffect, HueSaturationEffect, BrightnessContrastEffect, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const comp = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.comp = comp;
    comp.addPass(new RenderPass(scene, camera));
    const w = renderer.domElement.width, h = renderer.domElement.height;
    this.ao = new N8AOPostPass(scene, camera, w, h);
    const c = this.ao.configuration;
    c.aoRadius = 1.8;
    c.distanceFalloff = 1.0;
    c.intensity = 2.6;
    c.color = new THREE.Color('#05070d');
    c.halfRes = true;
    c.gammaCorrection = false;
    this.ao.setQualityMode('Medium');
    comp.addPass(this.ao);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.82, luminanceSmoothing: 0.25, intensity: 1.25, radius: 0.74, levels: 7 });
    this.tilt = new TiltShiftEffect({ focusArea: 0.46, feather: 0.34, offset: 0.04, kernelSize: KernelSize.LARGE, resolutionScale: 0.5 });
    this.outline = new OutlineEffect(scene, camera, {
      blendFunction: BlendFunction.SCREEN, edgeStrength: 3.2, pulseSpeed: 0, visibleEdgeColor: 0xffc27a, hiddenEdgeColor: 0x5a3a1a,
      blur: true, kernelSize: KernelSize.SMALL, xRay: true, resolutionScale: 0.75,
    });
    this.sound = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.bc = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.06 });
    this.hs = new HueSaturationEffect({ saturation: 0.1 });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.66 });
    this.grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.grain.blendMode.opacity.value = 0.09;
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    comp.addPass(new EffectPass(camera, this.bloom));
    comp.addPass(new EffectPass(camera, this.tilt));
    comp.addPass(new EffectPass(camera, this.outline, this.sound, this.bc, this.hs, this.vignette, this.grain));
    comp.addPass(new EffectPass(camera, this.smaa));
  }
  setSize(w, h) { this.comp.setSize(w, h); }
  render(dt) { this.comp.render(dt); }
  show(objects) { this.outline.selection.set(objects || []); }
}
