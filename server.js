require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise'); // Usamos la versión promise
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();

// Configuración de middlewares de seguridad
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Limitar peticiones (100 por 15 minutos)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Pool de conexiones para mejor manejo
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306, // Puerto estándar de MySQL
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

// Verificar conexión a la base de datos
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('Conectado a la base de datos MySQL');
    conn.release();
  } catch (err) {
    console.error('Error de conexión a la base de datos:', err);
    process.exit(1);
  }
})();

// --- RUTAS PARA EL JUEGO "ELIGE LO SALUDABLE" --- //

// Registrar nuevo jugador
app.post('/api/jugadores', async (req, res) => {
  try {
    const { nombre } = req.body;
    const [result] = await pool.query(
      'INSERT INTO jugador_saludable (nombre) VALUES (?)', 
      [nombre]
    );
    
    res.status(201).json({
      success: true,
      jugador_id: result.insertId,
      nombre
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Error al registrar jugador' 
    });
  }
});

// Obtener alimentos por nivel
app.get('/api/niveles/:nivel/alimentos', async (req, res) => {
  try {
    const nivelId = req.params.nivel;
    
    const [alimentos] = await pool.query(`
      SELECT a.*, na.es_correcta 
      FROM alimento_saludable a
      JOIN nivel_alimento_saludable na ON a.id = na.alimento_id
      WHERE na.nivel_id = ?
    `, [nivelId]);
    
    if (alimentos.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Nivel no encontrado' 
      });
    }
    
    res.json({ 
      success: true,
      alimentos 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Error al obtener alimentos' 
    });
  }
});

// Iniciar nueva partida
app.post('/api/partidas', async (req, res) => {
  try {
    const { jugador_id } = req.body;
    const [result] = await pool.query(
      'INSERT INTO partida_saludable (jugador_id) VALUES (?)',
      [jugador_id]
    );
    
    res.status(201).json({ 
      success: true,
      partida_id: result.insertId 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Error al iniciar partida' 
    });
  }
});

// Registrar respuesta del jugador
app.post('/api/respuestas', async (req, res) => {
  try {
    const { partida_id, nivel_id, alimento_id, correcta, tiempo } = req.body;
    
    // Calcular puntos (ejemplo: más puntos por responder rápido correctamente)
    const puntos = correcta ? Math.max(100 - Math.floor(tiempo), 10) : 0;
    
    await pool.query(
      `INSERT INTO respuesta_saludable 
      (partida_id, nivel_id, alimento_elegido_id, correcta, tiempo_segundos, puntos_obtenidos)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [partida_id, nivel_id, alimento_id, correcta, tiempo, puntos]
    );
    
    // Actualizar puntuación total en partida
    await pool.query(
      `UPDATE partida_saludable 
       SET puntuacion_total = puntuacion_total + ?
       WHERE id = ?`,
      [puntos, partida_id]
    );
    
    res.json({ 
      success: true,
      puntos_obtenidos: puntos 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Error al registrar respuesta' 
    });
  }
});

// Finalizar partida
app.patch('/api/partidas/:id/finalizar', async (req, res) => {
  try {
    const partidaId = req.params.id;
    const { nivel_maximo } = req.body;
    
    await pool.query(
      `UPDATE partida_saludable 
       SET fecha_fin = NOW(), nivel_maximo_alcanzado = ?
       WHERE id = ?`,
      [nivel_maximo, partidaId]
    );
    
    // Actualizar puntuación máxima del jugador
    await pool.query(
      `UPDATE jugador_saludable j
       JOIN partida_saludable p ON j.id = p.jugador_id
       SET j.puntuacion_maxima = GREATEST(j.puntuacion_maxima, p.puntuacion_total)
       WHERE p.id = ?`,
      [partidaId]
    );
    
    res.json({ 
      success: true,
      mensaje: 'Partida finalizada correctamente'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Error al finalizar partida' 
    });
  }
});

// Obtener ranking de jugadores
app.get('/api/jugadores/ranking', async (req, res) => {
  try {
    const [ranking] = await pool.query(`
      SELECT id, nombre, puntuacion_maxima 
      FROM jugador_saludable 
      ORDER BY puntuacion_maxima DESC 
      LIMIT 10
    `);
    
    res.json({ 
      success: true,
      ranking 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Error al obtener ranking' 
    });
  }
});

// Middleware para manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false,
    error: 'Error interno del servidor' 
  });
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});