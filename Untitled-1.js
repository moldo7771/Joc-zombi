window.onload = () => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const playerHPEl = document.getElementById('playerHP');
  const cityHPEl   = document.getElementById('cityHP');
  const killsEl    = document.getElementById('kills');
  const waveEl     = document.getElementById('wave');
  const menu       = document.getElementById('menu');
  const startBtn   = document.getElementById('startBtn');
  const gameOver   = document.getElementById('gameOver');
  const gameOverTitle = document.getElementById('gameOverTitle');
  const gameOverMsg   = document.getElementById('gameOverMsg');
  const restartBtn = document.getElementById('restartBtn');

  let rocketsEl = document.getElementById('rockets');
  if (!rocketsEl) {
    const hudLeft = document.querySelector('.hud .left');
    if (hudLeft) {
      const div = document.createElement('div');
      div.innerHTML = `🚀 Rockets: <span id="rockets">0</span>`;
      hudLeft.appendChild(div);
      rocketsEl = document.getElementById('rockets');
    }
  }

  const playerImg = new Image(); playerImg.src = 'player.png';
  const zombieImg = new Image(); zombieImg.src = 'zombi.png';
  const rocketImg = new Image(); rocketImg.src = 'racheta.png';
  const cityImg   = new Image(); cityImg.src   = 'city.png';
  const friendImg = new Image(); friendImg.src = 'caracter2.png'; // friend sprite

  const W = canvas.width, H = canvas.height;

  let state = 'menu';
  let player, bullets, zombies, particles, rockets = 0, rocketProjectiles, input, city, kills, wave, rngSeed;
  let powerUps, obstacles, friend;
  let beamEffects = [];
  let pendingSpawnAfterUpgrade = false;

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx*dx + dy*dy; };
  const rand = () => { rngSeed = (1664525 * rngSeed + 1013904223) >>> 0; return rngSeed / 0xffffffff; };
  const randRange = (a, b) => a + rand() * (b - a);

  
  const ZOMBIE_ATTACK_COOLDOWN_FRAMES = 35;
  const ROCKET_BLAST_RADIUS            = 110;
  const POWERUP_LIFE_FRAMES            = 900;
  const LASER_COOLDOWN_FRAMES          = 28;
  const LASER_RANGE                    = 900;
  const LASER_DAMAGE                   = 30;
  const SHOTGUN_PELLETS                = 6;
  const SHOTGUN_SPREAD                 = 0.25;
  const SHOTGUN_DAMAGE                 = 10;

  
  const allUpgrades = [
    { id:'move_speed', name:'⚡ Viteză +20%', desc:'Te miști mai repede', apply:()=>player.speed *= 1.2 },
    { id:'rof',        name:'🔫 Fire rate +25%', desc:'Tragi mai des', apply:()=>player.fireRate *= 0.75 },
    { id:'hp',         name:'❤️ HP +30', desc:'Mai multă viață', apply:()=>player.hp = Math.min(player.maxHP, player.hp+30) },
    { id:'maxhp',      name:'🧬 Max HP +30', desc:'Crește viața maximă', apply:()=>{ player.maxHP += 30; player.hp += 30; } },
    { id:'damage',     name:'💥 Damage +20%', desc:'Gloanțe & laser mai tari', apply:()=>{ player.damage *= 1.2; player.laserDamage *= 1.2; } },
    { id:'pierce',     name:'🎯 Penetrare +1', desc:'Gloanțele trec prin +1 zombie', apply:()=>player.pierce += 1 },
    { id:'shotgun',    name:'🟣 Deblochezi Shotgun', desc:'Apasă tasta 2 pentru Shotgun', apply:()=>player.hasShotgun = true },
    { id:'laser',      name:'🔵 Deblochezi Laser', desc:'Apasă tasta 3 pentru Laser', apply:()=>player.hasLaser = true },
    { id:'rocket',     name:'🚀 +1 Rocket', desc:'Încă o rachetă', apply:()=>{ rockets += 1; updateHUD(); } },
  ];
  let upgradeChoices = [];

  
  input = { keys: {}, mouse: {x: W/2, y: H/2, down: false} };
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    input.keys[k] = true;

    
    if (k === 'f' && state === 'playing' && friend && friend.alive) {
      friend.alive = false;
      
      player.speed *= 1.2;
      player.damageMultiplier = (player.damageMultiplier || 1) * 1.5;
      addParticles(friend.x, friend.y, 20, 1.8);
      return;
    }

    if (state === 'upgrade') {
      if (k === '1' || k === '2' || k === '3') {
        const idx = parseInt(k) - 1;
        if (upgradeChoices[idx]) {
          upgradeChoices[idx].apply();
          state = 'playing';
          upgradeChoices = [];
          if (pendingSpawnAfterUpgrade) { spawnNextWave(); pendingSpawnAfterUpgrade = false; }
        }
      }
      e.preventDefault();
      return;
    }
    
    if (k === '1') player.weapon = 'pistol';
    if (k === '2' && player.hasShotgun) player.weapon = 'shotgun';
    if (k === '3' && player.hasLaser) player.weapon = 'laser';
  });
  window.addEventListener('keyup',   e => input.keys[e.key.toLowerCase()] = false);
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    input.mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    input.mouse.y = (e.clientY - rect.top)  * (canvas.height / rect.height);
  });
  canvas.addEventListener('mousedown', () => input.mouse.down = true);
  window.addEventListener('mouseup',   () => input.mouse.down = false);

  function spawnPlayer() {
    return {
      x: W * 0.25, y: H * 0.5, r: 16,
      speed: 2.6,
      hp: 100, maxHP: 100, alive: true,
      aim: { x: W*0.25, y: H*0.5 },
      fireCooldown: 0,
      fireRate: 12,
      damage: 10,
      damageMultiplier: 1,
      pierce: 0,
      weapon: 'pistol',
      hasShotgun: true,
      hasLaser: false,
      laserCooldown: 0,
      laserDamage: LASER_DAMAGE,
      shieldFrames: 0,
    };
  }

  function spawnCity() { return { x: W * 0.5, y: H * 0.5, r: 32, hp: 100 }; }


  function spawnFriend() {
    return {
      x: player.x - 26,   
      y: player.y + 0,
      r: 12,
      alive: true,
      followSpeed: 0.18,  
      offx: -26,
      offy: 0,
    };
  }

  
  function makeObstacles() {
    return [
      {x: W*0.38, y: H*0.20, w: 80, h: 160},
      {x: W*0.10, y: H*0.70, w: 120, h: 40},
      {x: W*0.70, y: H*0.25, w: 140, h: 40},
      {x: W*0.72, y: H*0.65, w: 80, h: 120},
    ];
  }
  function circleRectResolve(entity, rect) {
    const rx = rect.x, ry = rect.y, rw = rect.w, rh = rect.h;
    const closestX = clamp(entity.x, rx, rx+rw);
    const closestY = clamp(entity.y, ry, ry+rh);
    const dx = entity.x - closestX;
    const dy = entity.y - closestY;
    const d2 = dx*dx + dy*dy;
    if (d2 < entity.r*entity.r) {
      const d = Math.sqrt(Math.max(d2, 0.0001));
      const nx = dx / d, ny = dy / d;
      const push = entity.r - d;
      entity.x += nx * push;
      entity.y += ny * push;
      return true;
    }
    return false;
  }

  
  function spawnZombieWithType(speedScale=1) {
    const edge = Math.floor(rand()*4);
    const margin = 30;
    let x, y;
    if (edge === 0)      { x = -margin;    y = randRange(0, H); }
    else if (edge === 1) { x = W + margin; y = randRange(0, H); }
    else if (edge === 2) { x = randRange(0, W); y = -margin; }
    else                 { x = randRange(0, W); y = H + margin; }

    const pFast = clamp(0.40 + wave*0.01, 0.4, 0.6);
    const pTank = clamp(0.20 + wave*0.005, 0.2, 0.35);
    const roll  = rand();
    let type = 'normal';
    if (roll < pFast) type = 'fast';
    else if (roll < pFast + pTank) type = 'tank';
    else if (roll < pFast + pTank + 0.15) type = 'exploder';

    if (wave % 5 === 0 && rand() < 0.10) type = 'boss';

    let z = { x, y, r: 14, speed: 0.5, hp: 30, type, attackCooldown: 0, onDeathExplode:false };
    if (type === 'fast')   { z.speed = randRange(0.8, 1.2) * (1 + 0.06*wave)*speedScale; z.hp = 18 + 2*wave; z.r = 12; }
    if (type === 'tank')   { z.speed = randRange(0.25,0.4) * (1 + 0.04*wave)*speedScale; z.hp = 60 + 5*wave; z.r = 18; }
    if (type === 'exploder'){ z.speed = randRange(0.45,0.7) * (1 + 0.05*wave)*speedScale; z.hp = 26 + 3*wave; z.r=14; z.onDeathExplode = true; }
    if (type === 'boss')   { z.speed = randRange(0.35,0.55) * (1 + 0.06*wave)*speedScale; z.hp = 220 + 12*wave; z.r=22; }

    return z;
  }

  function spawnBullet(px, py, ang, speed, dmg, pierce=0) {
    return { x:px, y:py, vx:Math.cos(ang)*speed, vy:Math.sin(ang)*speed, r: 4, life: 90, damage:dmg, pierce };
  }

  function spawnRocketProjectile(px, py, tx, ty) {
    const ang = Math.atan2(ty - py, tx - px);
    const speed = 7.5;
    return { x:px, y:py, vx:Math.cos(ang)*speed, vy:Math.sin(ang)*speed, ang, life:300, w:40, h:25 };
  }

  function addParticles(x, y, n, pow) {
    for (let i=0;i<n;i++) {
      const a = rand()*TAU, s = randRange(0.5, 3) * pow;
      particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: randRange(20, 50) });
    }
  }


  function maybeDropPowerUp(x, y) {
    const dropChance = 0.15;
    if (rand() > dropChance) return;
    const types = ['hp','rocket','atk','dmg','shield'];
    const t = types[Math.floor(rand()*types.length)];
    powerUps.push({ x, y, r: 10, type: t, life: POWERUP_LIFE_FRAMES });
  }
  function applyPowerUp(pu) {
    if (pu.type === 'hp')     player.hp = Math.min(player.maxHP, player.hp + 25);
    if (pu.type === 'rocket') { rockets += 1; updateHUD(); }
    if (pu.type === 'atk')    player.fireRate = Math.max(4, player.fireRate * 0.7);
    if (pu.type === 'dmg')    { player.damage *= 1.25; player.laserDamage *= 1.25; }
    if (pu.type === 'shield') player.shieldFrames = Math.max(player.shieldFrames, 360);
  }


  function updateHUD() {
    playerHPEl.textContent = Math.max(0, Math.ceil(player.hp));
    cityHPEl.textContent   = Math.max(0, Math.ceil(city.hp));
    killsEl.textContent    = kills;
    waveEl.textContent     = wave;
    if (rocketsEl) rocketsEl.textContent = rockets;
  }

  function startGame() {
    reset();
    state = 'playing';
    menu.classList.add('hidden');
    gameOver.classList.add('hidden');
  }

  function endGame(title, msg) {
    state = 'over';
    gameOverTitle.textContent = title;
    gameOverMsg.textContent   = msg;
    gameOver.classList.remove('hidden');
  }

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  function performSacrifice() {
    if (!player.alive) return;
    addParticles(player.x, player.y, 120, 3);
    const removed = zombies.length;
    zombies.length = 0;
    const prevKills = kills; kills += removed;
    const prevRocketsAwarded = Math.floor(prevKills / 10);
    const newRocketsAwarded  = Math.floor(kills / 10);
    rockets += (newRocketsAwarded - prevRocketsAwarded);
    player.hp = 0; player.alive = false;
    updateHUD();
    if (city.hp > 0) endGame('You Saved the City', `You sacrificed yourself and purged ${removed} zombies. Total kills: ${kills}.`);
    else endGame('Bittersweet End', `Your sacrifice came too late. The city was lost.`);
  }

  function explodeAt(x, y) {
    let removed = 0;
    for (let i = zombies.length - 1; i >= 0; i--) {
      const z = zombies[i];
      const dx = z.x - x, dy = z.y - y;
      if (dx*dx + dy*dy <= ROCKET_BLAST_RADIUS * ROCKET_BLAST_RADIUS) {
        zombies.splice(i, 1); removed++;
        maybeDropPowerUp(z.x, z.y);
        addParticles(z.x, z.y, 8, 1.5);
      }
    }
    if (removed > 0) {
      const prevKills = kills; kills += removed;
      const prevRocketsAwarded = Math.floor(prevKills / 10);
      const newRocketsAwarded  = Math.floor(kills / 10);
      rockets += (newRocketsAwarded - prevRocketsAwarded);
    }
    addParticles(x, y, 200, 4);
    updateHUD();
  }

  function fireRocket() {
    if (!player.alive || rockets <= 0) return;
    rockets--;
    rocketProjectiles.push(spawnRocketProjectile(player.x, player.y, input.mouse.x, input.mouse.y));
    updateHUD();
  }

  function reset() {
    rngSeed = (Date.now() ^ 0xabcdef) >>> 0;
    player = spawnPlayer();
    city = spawnCity();
    bullets = [];
    zombies = [];
    particles = [];
    rocketProjectiles = [];
    powerUps = [];
    obstacles = makeObstacles();
    beamEffects = [];
    kills = 0; wave = 1;
    rockets = 0;
    friend = spawnFriend();
    updateHUD();
    spawnNextWave();
  }

  function spawnNextWave() {
    const perWave = 3 + wave;
    for (let i = 0; i < perWave; i++) zombies.push(spawnZombieWithType());
    wave++;
    updateHUD();
  }

  function pushOutOfObstacles(e) {
    for (const o of obstacles) circleRectResolve(e, o);
  }

  function tickWeaponsShooting() {
    player.fireCooldown -= 1;
    player.laserCooldown = Math.max(0, player.laserCooldown - 1);
    if (!input.mouse.down || player.fireCooldown > 0) return;

    const ang = Math.atan2(player.aim.y - player.y, player.aim.x - player.x);

    if (player.weapon === 'pistol') {
      const dmg = Math.round(player.damage * (player.damageMultiplier || 1));
      bullets.push(spawnBullet(player.x, player.y, ang, 6.2, dmg, player.pierce));
      player.fireCooldown = Math.max(4, Math.floor(player.fireRate));
    } else if (player.weapon === 'shotgun' && player.hasShotgun) {
      for (let i=0;i<SHOTGUN_PELLETS;i++) {
        const a = ang + randRange(-SHOTGUN_SPREAD, SHOTGUN_SPREAD);
        const dmg = Math.round(SHOTGUN_DAMAGE * (player.damageMultiplier || 1));
        bullets.push(spawnBullet(player.x, player.y, a, 6.0, dmg, 0));
      }
      player.fireCooldown = Math.max(10, Math.floor(player.fireRate*1.6));
      addParticles(player.x, player.y, 6, 1.2);
    } else if (player.weapon === 'laser' && player.hasLaser) {
      if (player.laserCooldown === 0) {
        const beam = { x1: player.x, y1: player.y, x2: player.x + Math.cos(ang)*LASER_RANGE, y2: player.y + Math.sin(ang)*LASER_RANGE, life: 6 };
        beamEffects.push(beam);
        const thickness = 14;
        for (let zi=zombies.length-1; zi>=0; zi--) {
          const z = zombies[zi];
          const d = pointSegmentDistance(z.x,z.y, beam.x1,beam.y1, beam.x2,beam.y2);
          if (d <= Math.max(thickness, z.r+2)) {
            z.hp -= player.laserDamage * (player.damageMultiplier || 1);
            addParticles(z.x, z.y, 3, 0.6);
            if (z.hp <= 0) killZombie(zi, z);
          }
        }
        player.laserCooldown = LASER_COOLDOWN_FRAMES;
        player.fireCooldown = 6;
      }
    }
  }

  function pointSegmentDistance(px,py, x1,y1,x2,y2){
    const vx=x2-x1, vy=y2-y1;
    const wx=px-x1, wy=py-y1;
    const c1 = vx*wx + vy*wy;
    if (c1<=0) return Math.hypot(px-x1, py-y1);
    const c2 = vx*vx + vy*vy;
    if (c2<=c1) return Math.hypot(px-x2, py-y2);
    const b = c1/c2;
    const bx = x1 + b*vx, by = y1 + b*vy;
    return Math.hypot(px-bx, py-by);
  }

  function killZombie(zi, z) {
    zombies.splice(zi, 1);
    const prevKills = kills; kills++;
    const prevRocketsAwarded = Math.floor(prevKills / 10);
    const newRocketsAwarded  = Math.floor(kills / 10);
    rockets += (newRocketsAwarded - prevRocketsAwarded);
    addParticles(z.x, z.y, 6, 1);
    maybeDropPowerUp(z.x, z.y);

    if (z.onDeathExplode) {
      const R = 55;
      addParticles(z.x, z.y, 40, 2);
      const d2p = (player.x - z.x)**2 + (player.y - z.y)**2;
      if (d2p <= R*R && player.alive && player.shieldFrames<=0) {
        player.hp -= 20;
        if (player.hp <= 0) { player.hp=0; player.alive=false; endGame('You Died', `The city fell with ${kills} kills. Press Restart to try again.`); }
      }
    }
    updateHUD();
  }

  function step() {
    requestAnimationFrame(step);
    if (state !== 'playing' && state !== 'upgrade') { draw(); return; }

    const k = input.keys;
    if (state === 'playing' && player.alive) {
      let dx = 0, dy = 0;
      if (k['w']) dy -= 1; if (k['s']) dy += 1; if (k['a']) dx -= 1; if (k['d']) dx += 1;
      if (dx || dy) {
        const len = Math.hypot(dx, dy) || 1;
        player.x = clamp(player.x + (dx/len)*player.speed, 0, W);
        player.y = clamp(player.y + (dy/len)*player.speed, 0, H);
      }
      pushOutOfObstacles(player);

      
      if (friend && friend.alive) {
        const targetX = player.x + (friend.offx || -26);
        const targetY = player.y + (friend.offy || 0);
        friend.x += (targetX - friend.x) * friend.followSpeed;
        friend.y += (targetY - friend.y) * friend.followSpeed;
        pushOutOfObstacles(friend);
      }

      player.aim.x = input.mouse.x; player.aim.y = input.mouse.y;

      
      tickWeaponsShooting();

      
      if (k['x']) { k['x'] = false; performSacrifice(); }

      
      if (k['r']) { k['r'] = false; fireRocket(); }

      
      if (player.shieldFrames > 0) player.shieldFrames--;
    }

    
    if (state === 'playing' && zombies.length === 0) {
      upgradeChoices = [];
      const pool = allUpgrades.slice();
      if (player.hasShotgun) removeFromPool(pool,'shotgun');
      if (player.hasLaser)   removeFromPool(pool,'laser');
      for (let i=0; i<3 && pool.length>0; i++){
        const idx = Math.floor(rand()*pool.length);
        upgradeChoices.push(pool.splice(idx,1)[0]);
      }
      state = 'upgrade';
      pendingSpawnAfterUpgrade = true;
    }

    
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.x < -10 || b.x > W+10 || b.y < -10 || b.y > H+10 || b.life <= 0) { bullets.splice(i,1); continue; }
    }

    
    for (let i = rocketProjectiles.length - 1; i >= 0; i--) {
      const r = rocketProjectiles[i];
      r.x += r.vx; r.y += r.vy; r.life--;
      if (pointInAnyObstacle({x:r.x, y:r.y})) {
        explodeAt(r.x, r.y); rocketProjectiles.splice(i,1); continue;
      }
      let impacted = false;
      for (let zi = zombies.length - 1; zi >= 0; zi--) {
        const z = zombies[zi];
        const rr = z.r + Math.max(r.w, r.h) * 0.5;
        const dx = z.x - r.x, dy = z.y - r.y;
        if (dx*dx + dy*dy < rr*rr) { impacted = true; break; }
      }
      if (impacted || r.x < -50 || r.x > W+50 || r.y < -50 || r.y > H+50 || r.life <= 0) {
        explodeAt(r.x, r.y);
        rocketProjectiles.splice(i, 1);
        continue;
      }
    }

    
    for (let zi = zombies.length - 1; zi >= 0; zi--) {
      const z = zombies[zi];
      const target = (player.alive && dist2(player, z) < dist2(city, z)) ? player : city;
      const ang = Math.atan2(target.y - z.y, target.x - z.x);
      z.x += Math.cos(ang) * z.speed;
      z.y += Math.sin(ang) * z.speed;
      pushOutOfObstacles(z);

      if (z.attackCooldown === undefined) z.attackCooldown = 0;
      if (z.attackCooldown > 0) z.attackCooldown--;

      const rr = (z.r + (target===player ? player.r : city.r));
      if (dist2(z, target) < rr*rr) {
        if (z.attackCooldown <= 0) {
          if (target === player) {
            if (player.shieldFrames<=0) {
              player.hp -= 10;
              addParticles(player.x, player.y, 4, 0.7);
              if (player.hp <= 0 && player.alive) { player.hp = 0; player.alive = false; endGame('You Died', `The city fell with ${kills} kills. Press Restart to try again.`); }
            }
          } else {
            city.hp -= 10;
            addParticles(city.x, city.y, 3, 0.6);
            if (city.hp <= 0) { city.hp = 0; endGame('City Lost', `Zombies overran the city. Kills: ${kills}.`); }
          }
          updateHUD();
          z.attackCooldown = ZOMBIE_ATTACK_COOLDOWN_FRAMES;
        }
      }

      
      for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi];
        const rr2 = (z.r + b.r);
        if (dist2(z, b) < rr2*rr2) {
          z.hp -= b.damage;
          addParticles(z.x, z.y, 3, 0.5);
          b.pierce -= 1;
          if (z.hp <= 0) { killZombie(zi, z); break; }
          if (b.pierce < 0) { bullets.splice(bi,1); }
        }
      }
    }

    
    for (let i=particles.length-1;i>=0;i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.98; p.vy *= 0.98; p.life -= 1;
      if (p.life <= 0) particles.splice(i,1);
    }

    
    for (let i=powerUps.length-1;i>=0;i--) {
      const pu = powerUps[i];
      pu.life--;
      if (pu.life<=0) { powerUps.splice(i,1); continue; }
      const d2p = (pu.x - player.x)**2 + (pu.y - player.y)**2;
      if (d2p < (pu.r + player.r)**2) {
        applyPowerUp(pu);
        powerUps.splice(i,1);
        addParticles(player.x, player.y, 20, 1.3);
        updateHUD();
      }
    }

    
    for (let i=beamEffects.length-1;i>=0;i--){
      beamEffects[i].life--;
      if (beamEffects[i].life<=0) beamEffects.splice(i,1);
    }

    draw();
  }

  function removeFromPool(pool, id){ const i=pool.findIndex(u=>u.id===id); if(i>=0) pool.splice(i,1); }
  function pointInAnyObstacle(p){
    for (const o of obstacles){
      if (p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h) return true;
    }
    return false;
  }

  function drawUpgradeOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('Alege un upgrade (1 / 2 / 3)', W/2, H*0.25);

    ctx.font = '16px sans-serif';
    const cardW = 280, cardH = 90, gap = 30;
    const startX = W/2 - (cardW*3 + gap*2)/2;
    for (let i=0;i<upgradeChoices.length;i++){
      const x = startX + i*(cardW+gap), y = H*0.35;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.strokeRect(x, y, cardW, cardH);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`${i+1}. ${upgradeChoices[i].name}`, x+cardW/2, y+32);
      ctx.font = '14px sans-serif';
      ctx.fillText(upgradeChoices[i].desc, x+cardW/2, y+58);
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0,0,W,H);

    
    ctx.globalAlpha = 0.06;
    for (let x=0; x<W; x+=40) ctx.fillRect(x,0,1,H);
    for (let y=0; y<H; y+=40) ctx.fillRect(0,y,W,1);
    ctx.globalAlpha = 1;

    
    ctx.save();
    ctx.fillStyle = 'rgba(150,150,160,0.35)';
    obstacles.forEach(o => ctx.fillRect(o.x, o.y, o.w, o.h));
    ctx.restore();

    
    if (cityImg.complete) {
      const size = city.r * 3;
      ctx.drawImage(cityImg, city.x - city.r, city.y - city.r, size, size);
    }

    
    if (player.alive) {
      ctx.strokeStyle = 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(player.aim.x, player.aim.y); ctx.stroke();

      
      ctx.save();
      ctx.translate(player.x, player.y);
      const ang = Math.atan2(player.aim.y - player.y, player.aim.x - player.x);
      ctx.rotate(ang);
      ctx.drawImage(playerImg, -20, -20, 40, 40);
      ctx.restore();

      
      if (player.shieldFrames>0){
        ctx.strokeStyle='rgba(120,200,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(player.x, player.y, player.r+6, 0, TAU); ctx.stroke();
        ctx.lineWidth=1;
      }
    } else {
      ctx.fillStyle = 'rgba(230,80,80,.8)';
      circle(player.x, player.y, player.r*0.6); ctx.fill();
    }

    
    if (friend) {
      if (friend.alive) {
        ctx.save();
        ctx.translate(friend.x, friend.y);
        const fang = Math.atan2(player.aim.y - friend.y, player.aim.x - friend.x);
        ctx.rotate(fang);
        if (friendImg.complete && friendImg.naturalWidth !== 0) {
          const size = friend.r * 2.5;
          ctx.drawImage(friendImg, -size/2, -size/2, size, size);
        } else {
          ctx.fillStyle = '#00aaff';
          ctx.beginPath(); ctx.arc(0, 0, friend.r, 0, TAU); ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#88ddff';
        circle(friend.x, friend.y, friend.r * 0.9); ctx.fill();
        ctx.restore();
      }
    }

    
    ctx.fillStyle = '#ffdf6e';
    bullets.forEach(b => { circle(b.x, b.y, b.r); ctx.fill(); });

    
    rocketProjectiles.forEach(r => {
      ctx.save(); ctx.translate(r.x, r.y);
      ctx.rotate(r.ang);
      ctx.drawImage(rocketImg, -r.w/2, -r.h/2, r.w, r.h);
      ctx.restore();
    });

    
    zombies.forEach(z => {
      ctx.save(); ctx.translate(z.x, z.y);
      const target = (player.alive && dist2(player, z) < dist2(city, z)) ? player : city;
      const zang = Math.atan2(target.y - z.y, target.x - z.x);
      ctx.rotate(zang);
      if (z.type==='fast')  ctx.globalAlpha = 0.95;
      if (z.type==='tank')  ctx.globalAlpha = 0.85;
      if (z.type==='boss')  ctx.globalAlpha = 1.0;
      ctx.drawImage(zombieImg, -25, -25, 50, 50);
      ctx.globalAlpha = 1;
      if (z.type==='tank' || z.type==='boss') {
        const w = 36, h = 4;
        const pct = Math.max(0, Math.min(1, z.hp / (z.type==='boss' ? (220+12*wave) : (60+5*wave))));
        ctx.rotate(-zang);
        ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(-w/2, -30, w, h);
        ctx.fillStyle='#f66'; ctx.fillRect(-w/2, -30, w*pct, h);
      }
      ctx.restore();
    });

    
    powerUps.forEach(pu=>{
      ctx.save();
      ctx.translate(pu.x, pu.y);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      circle(0,0, pu.r); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = '12px sans-serif'; ctx.textAlign='center';
      const icon = pu.type==='hp'?'❤️': pu.type==='rocket'?'🚀': pu.type==='atk'?'⚡': pu.type==='dmg'?'💥':'🛡';
      ctx.fillText(icon, 0, 4);
      ctx.restore();
    });

    
    beamEffects.forEach(b=>{
      ctx.save();
      ctx.strokeStyle='rgba(120,200,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(b.x1,b.y1); ctx.lineTo(b.x2,b.y2); ctx.stroke();
      ctx.lineWidth = 1; ctx.restore();
    });

    
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    particles.forEach(p => { circle(p.x, p.y, 2); ctx.fill(); });

    
    if (state === 'upgrade') drawUpgradeOverlay();
  }

  function circle(x,y,r){ ctx.beginPath(); ctx.arc(x,y,r,0,TAU); }

  
  player = { x: W*0.25, y: H*0.5, r: 16, hp: 100, maxHP:100, alive: true, aim: {x: W*0.25, y: H*0.5}, speed:2.6, damage:10, damageMultiplier:1, pierce:0, weapon:'pistol', hasShotgun:true, hasLaser:false, laserCooldown:0, laserDamage:LASER_DAMAGE, shieldFrames:0 };
  city   = { x: W*0.5, y: H*0.5, r: 32, hp: 100 };
  bullets = []; zombies = []; particles = []; rocketProjectiles = []; powerUps = []; obstacles = makeObstacles();
  
  friend = { x: player.x - 26, y: player.y, r: 12, alive:true, followSpeed:0.18, offx:-26, offy:0 };

  draw();
  step();
};
