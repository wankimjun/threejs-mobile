import * as THREE from './three.module.js';

/**
 * OrbitControls đơn giản, tự-contained: xoay (left click), zoom (wheel), không cần import EventDispatcher.
 */
class OrbitControls {
  constructor(object, domElement) {
    this.object = object;
    this.domElement = domElement;

    this.enabled = true;
    this.enableDamping = true;
    this.dampingFactor = 0.05;
    this.rotateSpeed = 1.0;
    this.zoomSpeed = 1.0;
    this.minDistance = 0;
    this.maxDistance = Infinity;
    this.minPolarAngle = 0;
    this.maxPolarAngle = Math.PI;

    this.target = new THREE.Vector3();

    this._spherical = new THREE.Spherical();
    this._offset = new THREE.Vector3();

    this._isDragging = false;
    this._lastMouse = new THREE.Vector2();

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);

    this.domElement.addEventListener('mousedown', this._onMouseDown);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  _onMouseDown(event) {
    if (!this.enabled) return;
    this._isDragging = true;
    this._lastMouse.set(event.clientX, event.clientY);
  }

  _onMouseMove(event) {
    if (!this.enabled || !this._isDragging) return;

    const dx = event.clientX - this._lastMouse.x;
    const dy = event.clientY - this._lastMouse.y;
    this._lastMouse.set(event.clientX, event.clientY);

    this._offset.subVectors(this.object.position, this.target);
    this._spherical.setFromVector3(this._offset);

    this._spherical.theta -= dx * 0.001 * this.rotateSpeed;
    this._spherical.phi -= dy * 0.001 * this.rotateSpeed;

    this._spherical.phi = Math.max(
      this.minPolarAngle,
      Math.min(this.maxPolarAngle, this._spherical.phi)
    );

    this._offset.setFromSpherical(this._spherical);
    this.object.position.copy(this.target).add(this._offset);
    this.object.lookAt(this.target);
  }

  _onMouseUp() {
    this._isDragging = false;
  }

  _onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();

    const scale = event.deltaY > 0 ? 1.05 : 0.95;
    this._offset.subVectors(this.object.position, this.target);
    this._offset.multiplyScalar(scale);

    const dist = this._offset.length();
    if (dist < this.minDistance) this._offset.setLength(this.minDistance);
    if (dist > this.maxDistance) this._offset.setLength(this.maxDistance);

    this.object.position.copy(this.target).add(this._offset);
    this.object.lookAt(this.target);
  }

  update() {
    this.object.lookAt(this.target);
  }

  dispose() {
    this.domElement.removeEventListener('mousedown', this._onMouseDown);
    this.domElement.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }
}

export { OrbitControls };
