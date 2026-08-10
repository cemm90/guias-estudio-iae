#!/usr/bin/env node
/* ============================================================
   actualizar-portada.js
   Regenera la lista de guías del index.html de la portada.

   Uso:  node actualizar-portada.js
         node actualizar-portada.js --dry     (solo muestra, no escribe)

   Cómo funciona:
   1. Recorre las subcarpetas del repositorio buscando un index.html.
   2. Lee el archivo guia.json de cada carpeta con los datos de la guía.
      Si no existe, lo crea con valores deducidos del propio HTML
      (título, cantidad de actividades, tarjetas y niveles) para que
      solo tengas que corregir lo que haga falta.
   3. Reescribe el bloque entre /* GUIAS:INICIO *\/ y /* GUIAS:FIN *\/
      del index.html de la raíz.

   No requiere instalar nada: solo Node.js.
   ============================================================ */

const fs = require("fs");
const path = require("path");

const RAIZ = process.cwd();
const PORTADA = path.join(RAIZ, "index.html");
const SOLO_VER = process.argv.includes("--dry");

/* Carpetas que nunca son guías */
const IGNORAR = new Set([
  ".git", ".github", "node_modules", "assets", "img", "images",
  "css", "js", "docs", ".vscode", ".idea"
]);

/* Emoji y color sugeridos según la asignatura */
const ESTILOS = [
  {re:/lenguaje|lengua|castellano|comunicaci/i, emoji:"🪄", color:"#6C3FB5", nombre:"Lenguaje y Comunicación"},
  {re:/matem|calculo|álgebra|algebra/i,          emoji:"🔢", color:"#1E88E5", nombre:"Matemática"},
  {re:/historia|geograf|sociales/i,              emoji:"🗺️", color:"#E0713A", nombre:"Historia y Geografía"},
  {re:/ciencias|naturales|biolog|f[ií]sica|qu[ií]mica/i, emoji:"🔬", color:"#2FA84F", nombre:"Ciencias Naturales"},
  {re:/ingl[ée]s|english/i,                      emoji:"🌍", color:"#D64545", nombre:"Inglés"},
  {re:/arte|m[úu]sica|tecnolog/i,                emoji:"🎨", color:"#C2419B", nombre:"Arte"},
  {re:/religi|filosof|[ée]tica/i,                emoji:"🕊️", color:"#7A8B3D", nombre:"Religión"}
];

const TEXTO_EJEMPLO = "✏️ Escribe aquí una descripción breve de los contenidos de esta guía.";

function estiloDe(texto){
  return ESTILOS.find(e => e.re.test(texto)) ||
         {emoji:"📘", color:"#6C3FB5", nombre:null};
}

/* --- Quita etiquetas HTML y normaliza espacios --- */
function limpiar(txt){
  return txt.replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ")
            .trim();
}

/* --- Deduce la descripción leyendo el HTML de la guía ---
   Prioridad:
     1. <meta name="description" content="...">
     2. La lista que sigue a "vas a practicar" en la pantalla de bienvenida
     3. null (se usa el texto de ejemplo)                              */
function descripcionDe(html){
  const meta = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if(meta) return limpiar(meta[1]);

  const bloque = html.match(/vas a practicar[\s\S]{0,120}?<ul>([\s\S]*?)<\/ul>/i);
  if(bloque){
    const puntos = (bloque[1].match(/<li>([\s\S]*?)<\/li>/gi) || [])
      .map(li => limpiar(li))
      .filter(Boolean);
    /* Suma puntos completos hasta ~200 caracteres, sin cortar frases a la mitad */
    if(puntos.length){
      const elegidos = [];
      let largo = 0;
      for(const p of puntos){
        if(elegidos.length && largo + p.length > 200) break;
        elegidos.push(p);
        largo += p.length + 3;
      }
      return elegidos.join(" · ") + (elegidos.length < puntos.length ? " y más." : "");
    }
  }
  return null;
}

/* --- Lee datos del HTML de una guía --- */
function analizarGuia(html){
  const titulo = (html.match(/<title>([\s\S]*?)<\/title>/i) || [,""])[1].trim();
  const actividades = (html.match(/\{\s*t\s*:\s*["'](?:mc|vf|orden|match|bv)["']/g) || []).length;
  const tarjetas    = (html.match(/\{\s*f\s*:\s*["']/g) || []).length;
  const niveles     = (html.match(/\bteoria\s*:\s*\{/g) || []).length;
  const desafio     = /const\s+DESAFIO\s*=/.test(html) ? 1 : 0;
  return {titulo, actividades, tarjetas, niveles: niveles + desafio, desc: descripcionDe(html)};
}

/* --- Etiquetas con el conteo de contenidos --- */
function etiquetasDe(info){
  const plural = (n, sing, plu) => n + " " + (n === 1 ? sing : plu);
  const tags = [];
  if(info.actividades) tags.push(plural(info.actividades, "actividad", "actividades"));
  if(info.tarjetas)    tags.push(plural(info.tarjetas, "tarjeta", "tarjetas"));
  if(info.niveles)     tags.push(plural(info.niveles, "nivel", "niveles"));
  return tags.length ? tags : ["Guía de repaso"];
}

/* --- Crea un guia.json inicial a partir de la carpeta y su HTML --- */
function proponerFicha(carpeta, html){
  const info = analizarGuia(html);
  const est  = estiloDe(carpeta + " " + info.titulo);

  /* Intenta separar "Asignatura · Curso · Unidad" desde el <title> */
  const partes = info.titulo.split(/\s*[·|–-]\s*/).filter(Boolean);
  const curso  = (info.titulo.match(/\d+\s*°?\s*(?:B[áa]sico|Medio)/i) || [""])[0].trim();

  return {
    asignatura: est.nombre || partes[1] || carpeta.replace(/[-_]/g," "),
    curso: curso || "Sin curso",
    unidad: partes[partes.length-1] || "Sin unidad",
    emoji: est.emoji,
    color: est.color,
    desc: info.desc || TEXTO_EJEMPLO,
    tags: etiquetasDe(info),
    listo: true,
    autoDesc: true,
    autoTags: true
  };
}

/* --- Recorre el repositorio --- */
function buscarGuias(){
  const guias = [], nuevas = [];

  for(const nombre of fs.readdirSync(RAIZ).sort()){
    if(IGNORAR.has(nombre) || nombre.startsWith(".")) continue;

    const dir = path.join(RAIZ, nombre);
    if(!fs.statSync(dir).isDirectory()) continue;

    const htmlPath = path.join(dir, "index.html");
    if(!fs.existsSync(htmlPath)){
      console.log(`   ⏭️  ${nombre}/ — sin index.html, se omite`);
      continue;
    }

    const fichaPath = path.join(dir, "guia.json");
    let ficha;

    const html = fs.readFileSync(htmlPath, "utf8");

    if(fs.existsSync(fichaPath)){
      try{
        ficha = JSON.parse(fs.readFileSync(fichaPath, "utf8"));
      }catch(e){
        console.error(`   ❌ ${nombre}/guia.json tiene un error de formato: ${e.message}`);
        console.error(`      Revísalo (comas o comillas) y vuelve a ejecutar.`);
        process.exitCode = 1;
        continue;
      }

      /* Campos en modo automático: se refrescan leyendo la guía.
         Pon "autoDesc": false o "autoTags": false en el guia.json
         para que respete lo que escribiste a mano.                */
      const info = analizarGuia(html);
      const cambios = [];

      const descAuto = ficha.autoDesc !== false &&
                       (ficha.desc === undefined || ficha.desc === TEXTO_EJEMPLO || ficha.autoDesc === true);
      if(descAuto && info.desc && info.desc !== ficha.desc){
        ficha.desc = info.desc;
        cambios.push("descripción");
      }

      if(ficha.autoTags !== false){
        const tags = etiquetasDe(info);
        if(JSON.stringify(tags) !== JSON.stringify(ficha.tags)){
          ficha.tags = tags;
          cambios.push("contenidos");
        }
      }

      if(cambios.length && !SOLO_VER){
        fs.writeFileSync(fichaPath, JSON.stringify(ficha, null, 2) + "\n", "utf8");
        console.log(`   🔄 ${nombre}/ — se actualizó ${cambios.join(" y ")} desde la guía`);
      }
    }else{
      ficha = proponerFicha(nombre, html);
      if(!SOLO_VER){
        fs.writeFileSync(fichaPath, JSON.stringify(ficha, null, 2) + "\n", "utf8");
      }
      nuevas.push(nombre);
      const avisoDesc = ficha.desc === TEXTO_EJEMPLO ? " (falta escribir la descripción)" : "";
      console.log(`   ✨ ${nombre}/ — guía nueva detectada, se creó su guia.json${avisoDesc}`);
    }

    ficha.carpeta = nombre;                       // siempre manda la carpeta real
    if(ficha.listo === undefined) ficha.listo = true;
    guias.push(ficha);
  }

  return {guias, nuevas};
}

/* --- Orden: primero las disponibles, luego por curso y asignatura --- */
function ordenar(guias){
  return guias.sort((a,b) =>
    (b.listo === true) - (a.listo === true) ||
    String(a.curso).localeCompare(String(b.curso), "es") ||
    String(a.asignatura).localeCompare(String(b.asignatura), "es")
  );
}

/* --- Escribe el bloque en la portada --- */
function actualizarPortada(guias){
  if(!fs.existsSync(PORTADA)){
    console.error("\n❌ No encuentro index.html en esta carpeta.");
    console.error("   Ejecuta el script desde la raíz del repositorio.\n");
    process.exit(1);
  }

  const html = fs.readFileSync(PORTADA, "utf8");
  const INI = "/* GUIAS:INICIO */", FIN = "/* GUIAS:FIN */";
  const a = html.indexOf(INI), b = html.indexOf(FIN);

  if(a === -1 || b === -1){
    console.error("\n❌ No encuentro las marcas GUIAS:INICIO / GUIAS:FIN en index.html.");
    console.error("   Deben rodear la línea 'const GUIAS = [...]' de la portada.\n");
    process.exit(1);
  }

  const campos = ["asignatura","curso","unidad","emoji","color","desc","tags","carpeta","listo"];
  const limpias = guias.map(g => {
    const o = {};
    campos.forEach(k => { if(g[k] !== undefined) o[k] = g[k]; });
    return o;
  });

  const bloque = INI + "\nconst GUIAS = " + JSON.stringify(limpias, null, 2) + ";\n";
  const nuevo  = html.slice(0, a) + bloque + html.slice(b);

  if(SOLO_VER){
    console.log("\n--- Vista previa (no se escribió nada) ---\n" + bloque);
    return;
  }

  fs.writeFileSync(PORTADA, nuevo, "utf8");
}

/* --- Ejecución --- */
console.log("\n📚 Actualizando la portada de guías...\n");

const {guias, nuevas} = buscarGuias();

if(process.exitCode === 1){
  console.log("\n🛑 No se modificó la portada porque hay un guia.json con errores.");
  console.log("   Corrígelo y vuelve a ejecutar el script.\n");
  process.exit(1);
}

if(!guias.length){
  console.log("\n⚠️  No encontré ninguna guía.");
  console.log("   Cada guía debe estar en su propia carpeta con un index.html adentro.\n");
  process.exit(0);
}

actualizarPortada(ordenar(guias));

console.log(`\n✅ Portada actualizada con ${guias.length} guía(s):`);
guias.forEach(g => console.log(`   ${g.listo ? "🟢" : "⚪️"} ${g.asignatura} — ${g.curso} (${g.carpeta}/)`));

const sinDesc = guias.filter(g => g.desc === TEXTO_EJEMPLO).map(g => g.carpeta);
if(sinDesc.length && !SOLO_VER){
  console.log(`\n📝 No pude deducir la descripción de: ${sinDesc.map(n => n + "/guia.json").join(", ")}`);
  console.log("   Escríbela a mano en ese archivo (el resto se mantiene automático).");
}

console.log("\n👉 Para publicar:  git add . && git commit -m \"Nueva guía\" && git push\n");
