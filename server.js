const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Conexión a base de datos Clever Cloud
const pool = mysql.createPool({
  host: 'bpblj72zmuo1mhhnuld0-mysql.services.clever-cloud.com',
  user: 'usuiu1orbir82bja',
  password: 'pFSy6M8BhoPeE4scWEq6',
  database: 'bpblj72zmuo1mhhnuld0',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Página principal
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Guardar resumen de partida
app.post('/api/finalizar-partida', async (req, res) => {
  try {
    const { partida_id } = req.body;

    const [partidaRes] = await pool.query(
      'SELECT * FROM partida_saludable WHERE id = ?',
      [partida_id]
    );
    const partida = partidaRes[0];
    if (!partida) return res.status(404).json({ success: false, error: 'Partida no encontrada' });

    const jugador_id = partida.jugador_id;

    const [jugadorRes] = await pool.query(
      'SELECT nombre FROM jugador_saludable WHERE id = ?',
      [jugador_id]
    );
    const jugador_nombre = jugadorRes[0]?.nombre || 'Desconocido';

    const [duracionRes] = await pool.query(
      'SELECT TIMESTAMPDIFF(SECOND, fecha_inicio, NOW()) AS duracion FROM partida_saludable WHERE id = ?',
      [partida_id]
    );
    const duracion_segundos = duracionRes[0].duracion;

    const [respuestas] = await pool.query(
      'SELECT COUNT(*) AS total, SUM(correcta) AS aciertos FROM respuesta_saludable WHERE partida_id = ?',
      [partida_id]
    );
    const total = respuestas[0].total;
    const aciertos = respuestas[0].aciertos || 0;
    const efectividad = total > 0 ? Math.round((aciertos / total) * 100) : 0;

    const vidas_perdidas = partida.vidas_iniciales - partida.vidas_restantes;

    const [ranking] = await pool.query(`
      SELECT id, jugador_id, puntuacion_total,
        RANK() OVER (ORDER BY puntuacion_total DESC) AS posicion
      FROM partida_saludable
      WHERE fecha_fin IS NOT NULL
    `);
    const posicion = ranking.find(r => r.id === partida.id)?.posicion || null;

    await pool.query('UPDATE partida_saludable SET fecha_fin = NOW() WHERE id = ?', [partida_id]);

    await pool.query(`
      INSERT INTO resumen_resultados_saludable
      (jugador_id, jugador_nombre, partida_id, nivel_maximo, puntuacion_total, vidas_perdidas, efectividad_porcentaje, posicion, duracion_segundos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      jugador_id,
      jugador_nombre,
      partida.id,
      partida.nivel_maximo_alcanzado,
      partida.puntuacion_total,
      vidas_perdidas,
      efectividad,
      posicion,
      duracion_segundos
    ]);

    res.json({ success: true, mensaje: 'Resumen guardado correctamente' });

  } catch (err) {
    console.error('❌ Error al finalizar partida:', err);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Obtener podio top 10 jugadores
app.get('/api/podio', async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        jugador_nombre AS nombre, 
        puntuacion_total AS puntaje, 
        posicion
      FROM resumen_resultados_saludable
      ORDER BY posicion ASC
      LIMIT 10
    `);
    res.json({ success: true, podio: rows });
  } catch (err) {
    console.error("❌ Error al obtener podio:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor en: http://localhost:${PORT}`);
});