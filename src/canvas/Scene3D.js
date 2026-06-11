import * as THREE from "../../vendor/three/three.module.js";
import { OrbitControls } from "../../vendor/three/OrbitControls.js";

export class Scene3D {
    constructor(containerElement) {
        this.container = containerElement;

        // 1. Core Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a4b84);

        // 2. Camera Setup (Perspective)
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 20000);

        // 3. Renderer Setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        // 4. Orbit Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

        // 5. Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
        this.sunLight.position.set(-1000, 2000, 1000);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.camera.left = -2000;
        this.sunLight.shadow.camera.right = 2000;
        this.sunLight.shadow.camera.top = 2000;
        this.sunLight.shadow.camera.bottom = -2000;
        this.sunLight.shadow.bias = -0.001;
        this.scene.add(this.sunLight);

        // State trackers
        this.animationFrameId = null;
        this.mesh = null;
        this.water = null;

        // Bind resizing
        this.resizeHandler = this.#onWindowResize.bind(this);
        window.addEventListener("resize", this.resizeHandler);

        // Start the render loop
        this.#animate();
    }

    /**
     * Ingests the 2D mathematical arrays and extrudes a 3D draped mesh.
     * @param {Float32Array} elevationData - The raw topographical heights.
     * @param {Uint8Array} biomePixelBuffer - The RGBA flat map to drape over the mesh.
     * @param {number} width - Map pixel width.
     * @param {number} height - Map pixel height.
     * @param {number} seaLevel - The mathematical sea level threshold.
     */
    /**
     * Ingests the 2D mathematical arrays and extrudes a 3D draped mesh.
     */
    render3DMap(elevationData, biomePixelBuffer, width, height, seaLevel, riverVectors, waterMask) {
        // Clean up existing meshes if we are regenerating
        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.mesh.material.map.dispose();
            this.mesh.material.dispose();
            this.scene.remove(this.mesh);
        }
        if (this.water) {
            this.water.geometry.dispose();
            this.water.material.dispose();
            this.scene.remove(this.water);
        }
        if (this.riverGroup) {
            this.riverGroup.children.forEach((child) => {
                child.geometry.dispose();
                child.material.dispose();
            });
            this.scene.remove(this.riverGroup);
        }

        // 1. Build the DataTexture from the Biome Buffer
        const texture = new THREE.DataTexture(biomePixelBuffer, width, height, THREE.RGBAFormat);
        texture.flipY = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 1,
            metalness: 0,
            side: THREE.DoubleSide,
        });

        // 2. Build the optimized Mesh Geometry
        const geoWidth = Math.min(width, 400);
        const geoHeight = Math.min(height, 400);
        const geometry = new THREE.PlaneGeometry(width, height, geoWidth, geoHeight);
        geometry.rotateX(-Math.PI / 2);

        // 3. Displace Vertices
        const pos = geometry.attributes.position;
        const altitudeMultiplier = 45;

        for (let i = 0; i < pos.count; i++) {
            const vx = pos.getX(i);
            const vz = pos.getZ(i);

            const mapX = Math.round(vx + width / 2);
            const mapY = Math.round(vz + height / 2);

            const safeX = Math.max(0, Math.min(mapX, width - 1));
            const safeY = Math.max(0, Math.min(mapY, height - 1));

            const elevIndex = safeY * width + safeX;
            const displayElev = (elevationData[elevIndex] - seaLevel) * altitudeMultiplier;

            pos.setY(i, displayElev);
        }

        geometry.computeVertexNormals();
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.scene.add(this.mesh);

        // 4. Render the Global Ocean Plane
        const waterGeo = new THREE.PlaneGeometry(width * 1.5, height * 1.5);
        waterGeo.rotateX(-Math.PI / 2);
        const waterMat = new THREE.MeshStandardMaterial({
            color: 0x5cb8ff,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            roughness: 0.1,
            metalness: 0.6,
        });

        this.water = new THREE.Mesh(waterGeo, waterMat);
        this.water.position.y = 0;
        this.water.receiveShadow = true;
        this.scene.add(this.water);

        // 5. Render 3D Topographical River Vectors
        if (riverVectors && riverVectors.length > 0) {
            this.riverGroup = new THREE.Group();

            const waterColor = new THREE.Color(0x78aad2);
            const frozenColor = new THREE.Color(0xe1ebf0);
            const matWater = new THREE.LineBasicMaterial({ color: waterColor });
            const matIce = new THREE.LineBasicMaterial({ color: frozenColor });

            for (const river of riverVectors) {
                if (!river.path || river.path.length < 2) continue;

                let currentPoints = [];
                let currentIsFrozen = null;

                for (const point of river.path) {
                    const safeX = Math.max(0, Math.min(Math.round(point.x), width - 1));
                    const safeY = Math.max(0, Math.min(Math.round(point.y), height - 1));
                    const elevIndex = safeY * width + safeX;

                    // Check if this exact coordinate is mathematically submerged
                    const isWater = waterMask && waterMask[elevIndex] > 0;

                    // Break the vector path if it hits a lake or the ocean
                    if (point.isLake || isWater) {
                        if (currentPoints.length > 1) {
                            const geo = new THREE.BufferGeometry().setFromPoints(currentPoints);
                            this.riverGroup.add(new THREE.Line(geo, currentIsFrozen ? matIce : matWater));
                        }
                        currentPoints = [];
                        continue;
                    }

                    // Map 2D pixel coordinates to the 3D plane
                    const vx = point.x - width / 2;
                    const vz = point.y - height / 2;

                    const displayElev = (elevationData[elevIndex] - seaLevel) * altitudeMultiplier;
                    const vec3 = new THREE.Vector3(vx, displayElev + 1.5, vz);

                    if (currentPoints.length === 0) {
                        currentIsFrozen = point.isFrozen;
                        currentPoints.push(vec3);
                    } else if (point.isFrozen === currentIsFrozen) {
                        currentPoints.push(vec3);
                    } else {
                        currentPoints.push(vec3);
                        const geo = new THREE.BufferGeometry().setFromPoints(currentPoints);
                        this.riverGroup.add(new THREE.Line(geo, currentIsFrozen ? matIce : matWater));
                        currentPoints = [vec3];
                        currentIsFrozen = point.isFrozen;
                    }
                }

                if (currentPoints.length > 1) {
                    const geo = new THREE.BufferGeometry().setFromPoints(currentPoints);
                    this.riverGroup.add(new THREE.Line(geo, currentIsFrozen ? matIce : matWater));
                }
            }

            this.riverGroup.children.forEach((child) => {
                child.castShadow = false;
            });
            this.scene.add(this.riverGroup);
        }

        // 6. Position Camera
        this.camera.position.set(0, Math.max(width, height) * 0.8, Math.max(width, height) * 0.8);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    #onWindowResize() {
        if (!this.container || !this.camera || !this.renderer) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    #animate() {
        this.animationFrameId = requestAnimationFrame(this.#animate.bind(this));
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener("resize", this.resizeHandler);
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

        if (this.mesh) {
            this.mesh.geometry.dispose();
            if (this.mesh.material.map) this.mesh.material.map.dispose();
            this.mesh.material.dispose();
        }
        if (this.water) {
            this.water.geometry.dispose();
            this.water.material.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
    }
}
