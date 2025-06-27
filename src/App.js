import React, { useEffect, useRef, useState } from 'react';
import * as mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import 'mapbox-gl/dist/mapbox-gl.css';

const App = () => {
  const mapContainerRef = useRef();
  const mapRef = useRef();
  const [userLocation, setUserLocation] = useState(null);
  const [isModelLoading, setIsModelLoading] = useState(true);

  // Lấy vị trí hiện tại của người dùng
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lng: position.coords.longitude,
            lat: position.coords.latitude,
          });
        },
        (error) => {
          console.error("Error getting location: ", error);
        }
      );
    } else {
      console.error("Geolocation is not supported by this browser.");
    }
  }, []);

  // Khởi tạo bản đồ
  useEffect(() => {
    if (!userLocation) return; // Chỉ tạo bản đồ khi có vị trí người dùng

    mapboxgl.accessToken = 'pk.eyJ1IjoiZGFuZ2FuaDI4NTk3IiwiYSI6ImNtYzBvazI5dzA0cWEybXB5bGw2OTR5aGIifQ.QmoEj4F4iS4nWPLtF8d_0w';

    // Để setState function có thể được truy cập từ custom layer
    window.setIsModelLoading = setIsModelLoading;

    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v11', // Kiểu bản đồ
      center: [105.8901, 21.0447], // Tọa độ Long Biên, Việt Nam
      zoom: 16, // Tăng zoom để dễ thấy mô hình
      pitch: 60, // Tăng pitch để dễ thấy mô hình 3D
      bearing: 0, // Hướng tầm nhìn
      fadeDuration: 0, // Tắt fade effect để mượt hơn
    });

    // Đơn giản hóa custom layer
    const customLayer = {
      id: 'house-3d-model',
      type: 'custom',
      renderingMode: '3d',
      
      onAdd: function (map, gl) {
        // Thiết lập Three.js scene
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.map = map;

        // Thiết lập ánh sáng đơn giản
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);

        // Load mô hình GLB với tối ưu hóa
        const loader = new GLTFLoader();
        console.log('Starting to load GLB model...');
        
        loader.load(
          '/models/house.glb',
          (gltf) => {
            console.log('GLB model loaded successfully!', gltf);
            this.model = gltf.scene;
            
            // Tối ưu hóa model
            this.model.traverse((child) => {
              if (child.isMesh) {
                // Tối ưu geometry nếu có thể
                if (child.geometry.dispose) {
                  child.geometry.computeBoundingBox();
                }
                // Tối ưu material
                if (child.material) {
                  child.material.needsUpdate = false;
                }
              }
            });
            
            // Scale và position
            this.model.scale.set(100, 100, 100);
            this.model.position.set(0, 0, 0);
            this.model.rotation.set(0, 0, 0);
            
            // Đảm bảo model sẵn sàng render
            this.model.updateMatrixWorld(true);
            
            this.scene.add(this.model);
            console.log('Model added to scene and optimized');
            
            // Trigger repaint duy nhất sau khi load xong
            setTimeout(() => {
              map.triggerRepaint();
              // Đánh dấu model đã load xong
              if (window.setIsModelLoading) {
                window.setIsModelLoading(false);
              }
            }, 100);
          },
          (progress) => {
            console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
          },
          (error) => {
            console.error('Error loading GLB model:', error);
          }
        );

        // Thiết lập renderer với tối ưu hóa
        this.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true,
          alpha: true,
          powerPreference: "high-performance" // Ưu tiên hiệu suất
        });
        
        this.renderer.autoClear = false;
        this.renderer.sortObjects = false; // Tắt sorting để tăng tốc
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Giới hạn pixel ratio
        
        console.log('Custom layer initialized with optimizations');
      },

      render: function (gl, matrix) {
        if (!this.model) return;

        // Cache tọa độ để tránh tính toán lại mỗi frame
        if (!this.modelAsMercatorCoordinate) {
          const modelOrigin = [105.8901, 21.0447];
          const modelAltitude = 0;
          this.modelAsMercatorCoordinate = mapboxgl.MercatorCoordinate.fromLngLat(
            modelOrigin,
            modelAltitude
          );
        }

        // Cache rotation matrices để tránh tính toán lại
        if (!this.rotationMatrices) {
          const rotateX = Math.PI / 2;
          this.rotationMatrices = {
            rotationX: new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), rotateX),
            rotationY: new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), 0),
            rotationZ: new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), 0)
          };
        }

        // Tạo transform matrix với cached values
        const scale = this.modelAsMercatorCoordinate.meterInMercatorCoordinateUnits();
        
        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(
            this.modelAsMercatorCoordinate.x,
            this.modelAsMercatorCoordinate.y,
            this.modelAsMercatorCoordinate.z
          )
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(this.rotationMatrices.rotationX)
          .multiply(this.rotationMatrices.rotationY)
          .multiply(this.rotationMatrices.rotationZ);

        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        
        // Chỉ trigger repaint khi cần thiết
        if (!this.isAnimating) {
          this.isAnimating = true;
          requestAnimationFrame(() => {
            this.isAnimating = false;
          });
        }
      }
    };

    // Thêm layer khi map load xong
    mapRef.current.on('style.load', () => {
      console.log('Map style loaded, adding custom layer...');
      
      // Thêm custom layer CHO MÔ HÌNH 3D TRƯỚC
      mapRef.current.addLayer(customLayer);
      
      // Thêm DEM source
      mapRef.current.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.terrain-rgb',
        tileSize: 512,
        maxzoom: 14,
      });

      // Thêm terrain
      mapRef.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

      // Thêm buildings 3D
      mapRef.current.addLayer({
        'id': '3d-buildings',
        'type': 'fill-extrusion',
        'source': 'composite',
        'source-layer': 'building',
        'paint': {
          'fill-extrusion-color': '#aaa',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.6
        }
      });
    });

    // Thêm Marker cho vị trí hiện tại của người dùng
    const marker = new mapboxgl.Marker({
      element: document.createElement('div'),
    })
      .setLngLat([userLocation.lng, userLocation.lat])
      .setPopup(new mapboxgl.Popup().setHTML("<h3>Vị trí của tôi</h3>"))
      .addTo(mapRef.current);

    // Cài đặt biểu tượng cho Marker
    const markerElement = marker.getElement();
    markerElement.style.backgroundImage = `url(/models/house.glb)`;
    markerElement.style.backgroundSize = 'contain';
    markerElement.style.width = '30px';
    markerElement.style.height = '30px';

    // Thêm chức năng hướng dẫn đường từ vị trí hiện tại đến Hồ Gươm
    const start = [userLocation.lng, userLocation.lat]; // Tọa độ vị trí hiện tại của người dùng
    const end = [105.854444, 21.028511]; // Tọa độ Hồ Gươm

    // Gọi API Mapbox Directions để tính toán lộ trình
    fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?alternatives=false&geometries=geojson&access_token=${mapboxgl.accessToken}`)
      .then(response => response.json())
      .then(data => {
        const route = data.routes[0].geometry;

        // Vẽ lộ trình lên bản đồ
        mapRef.current.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: route,
          },
        });

        mapRef.current.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#3b9ddd',
            'line-width': 5,
            'line-opacity': 0.75,
          },
        });
      })
      .catch(err => console.error('Error fetching directions: ', err));

  }, [userLocation]);

  return (
    <div>
      {isModelLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          transition: 'opacity 0.5s ease-out'
        }}>
          <div style={{
            padding: '20px',
            backgroundColor: 'white',
            borderRadius: '10px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            textAlign: 'center'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #3498db',
              borderRadius: '50%',
              animation: 'spin 2s linear infinite',
              margin: '0 auto 10px'
            }}></div>
          </div>
        </div>
      )}
      <div
        style={{ height: '100vh' }}
        ref={mapContainerRef}
        className="map-container"
      />
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default App;
