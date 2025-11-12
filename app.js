// ====================== IMPORT MODULE ======================
const express = require('express');        // Framework web untuk membuat server HTTP
const mysql = require('mysql2/promise');   // Library MySQL yang mendukung async/await
const mqtt = require('mqtt');              // Library untuk komunikasi dengan broker MQTT

// ====================== INISIALISASI SERVER ======================
const app = express();                     // Membuat instance aplikasi Express
const port = process.env.PORT || 3000;     // Menentukan port server (default 3000)

// ====================== KONFIGURASI DATABASE ======================
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'laragon',
  database: 'iot_uts'
};

// ====================== NAMA TOPIK MQTT ======================
const TOPIC_SUHU = 'tes/suhu';             // Topik untuk data suhu & kelembapan
const TOPIC_LDR  = 'tes/kecerahan';        // Topik untuk data sensor cahaya (LDR)

// ====================== KONFIGURASI MQTT CLIENT ======================
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com:1883', {
  clientId: 'node-bridge-' + Math.random().toString(16).slice(2) + '-' + Date.now(), // ID unik setiap koneksi
  reconnectPeriod: 2000,       // Coba reconnect setiap 2 detik jika koneksi terputus
  connectTimeout: 10000,       // Batas waktu koneksi 10 detik
  keepalive: 60,               // Kirim ping setiap 60 detik agar koneksi tetap hidup
  clean: true                  // Set "clean session" agar tidak menyimpan session lama
});

// ====================== EVENT: BERHASIL TERHUBUNG KE MQTT ======================
mqttClient.on('connect', (connack) => {
  console.log('✅ MQTT Connected to broker.hivemq.com:', connack);
  // Subscribe ke dua topik utama (suhu dan kecerahan)
  mqttClient.subscribe([TOPIC_SUHU, TOPIC_LDR], (err) => {
    if (err) console.error('❌ Subscribe failed:', err.message);
    else console.log('📡 Subscribed to topics:', TOPIC_SUHU, TOPIC_LDR);
  });
});

// ====================== EVENT: ERROR & STATUS KONEKSI MQTT ======================
mqttClient.on('error', (err) => console.error('❌ MQTT Error:', err.message)); // Jika ada error koneksi
mqttClient.on('reconnect', () => console.log('↻ MQTT reconnecting...'));       // Jika mencoba reconnect
mqttClient.on('offline', () => console.log('⏸️ MQTT offline'));                // Jika broker tidak aktif
mqttClient.on('close', () => console.log('🔌 MQTT connection closed'));         // Jika koneksi ditutup

// ====================== EVENT: SAAT MENERIMA PESAN DARI MQTT ======================
mqttClient.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());   // Ubah pesan JSON jadi objek
    const conn = await mysql.createConnection(dbConfig); // Buka koneksi database

    // Jika pesan dari topik suhu → simpan data suhu dan kelembapan
    if (topic === TOPIC_SUHU) {
      await conn.execute(
        'INSERT INTO data_sensor (suhu, humidity) VALUES (?, ?)',
        [data.temperature, data.humidity]
      );
      console.log(`💾 Suhu tersimpan: ${data.temperature}°C, Hum=${data.humidity}%`);

    // Jika pesan dari topik LDR → update nilai kecerahan di data terakhir
    } else if (topic === TOPIC_LDR) {
      await conn.execute(
        'UPDATE data_sensor SET lux = ? ORDER BY id DESC LIMIT 1',
        [data.brightness]
      );
      console.log(`💾 Kecerahan diperbarui: ${data.brightness}`);
    }

    await conn.end(); // Tutup koneksi ke database setelah insert/update

  } catch (err) {
    console.error('❌ MQTT → SQL Error:', err.message); // Tangani error database
  }
});

// ====================== ENDPOINT API UNTUK AMBIL DATA SENSOR ======================
app.get('/api/sensor', async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig); // Koneksi ke database

    // Ambil data statistik suhu (max, min, dan rata-rata)
    const [statsRows] = await conn.execute(`
      SELECT 
        MAX(suhu) AS suhumax, 
        MIN(suhu) AS suhumin, 
        ROUND(AVG(suhu),2) AS suhurata 
      FROM data_sensor
    `);
    const stats = statsRows[0];

    // Ambil 10 data sensor terbaru
    const [rows] = await conn.execute(`
      SELECT id, suhu, humidity, lux AS kecerahan, 
      DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%s') AS waktu
      FROM data_sensor
      ORDER BY id DESC
      LIMIT 10
    `);

    // Kirim hasil dalam format JSON
    res.json({
      suhumax: stats.suhumax,
      suhumin: stats.suhumin,
      suhurata: stats.suhurata,
      data: rows
    });

  } catch (err) {
    console.error('❌ API Error:', err.message);           // Tangani error jika query gagal
    res.status(500).json({ error: err.message });          // Kirim pesan error ke client
  } finally {
    if (conn) await conn.end(); // Tutup koneksi DB di akhir
  }
});

// ====================== HALAMAN UTAMA SERVER ======================
app.get('/', (req, res) => {
  // Tampilkan informasi server dan endpoint
  res.send(`
    <h2>✅ Server Node.js Aktif (HiveMQ Publik)</h2>
    <p>Broker: <b>mqtt://broker.hivemq.com:1883</b></p>
    <ul>
      <li>Topic suhu: <code>${TOPIC_SUHU}</code></li>
      <li>Topic LDR: <code>${TOPIC_LDR}</code></li>
      <li><a href="/api/sensor">/api/sensor</a> → lihat data JSON</li>
    </ul>
  `);
});

// ====================== JALANKAN SERVER ======================
app.listen(port, () => {
  console.log(`🚀 Server berjalan di http://localhost:${port}`);
});
