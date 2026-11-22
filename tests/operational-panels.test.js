import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import pg from 'pg';
import {temporaryPostgres} from './postgres.js';
import {migrateDatabase} from '../src/db/migrations.js';
import {createApp} from '../src/server.js';
import {buildOperational} from '../scripts/build-operational.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

test('las doce pantallas abren en ambos temas y cuatro tamaños; los contactos se guardan', {timeout:120000}, async () => {
  let database,pool,server,browser,directory;
  try {
    database=await temporaryPostgres();
    pool=new pg.Pool({connectionString:database.connectionString});
    await migrateDatabase(pool);
    await pool.query('INSERT INTO suplidores(nombre,correo,contacto,tel) VALUES($1,$2,$3,$4)',[
      'Suplidor de prueba con descripción extensa '.repeat(6),'correo-muy-largo'.repeat(8)+'@ejemplo.test',
      'Contacto de prueba '.repeat(12),'809-555-0000 '.repeat(8)]);
    directory=await mkdtemp(join(tmpdir(),'felix-paneles-'));
    await buildOperational(directory);
    server=await createApp(pool,{assetsDirectory:pathToFileURL(directory+sep)});
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    browser=await chromium.launch({channel:'msedge',headless:true});
    const origin='http://127.0.0.1:'+server.address().port;
    const context=await browser.newContext();
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const routes=['/','/ventas','/inventario','/compras','/caja','/clientes','/suplidores','/reportes','/cuentas-por-cobrar','/cuentas-por-pagar','/configuracion','/ayuda'];
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:1000});
      for(const route of routes){
        await page.goto(origin+route);
        await page.getByRole('main').getByRole('heading',{level:1}).waitFor();
        assert.equal(await page.getByText(/El módulo de .*está en preparación/).count(),0,route);
        for(const theme of ['claro','oscuro']){
          if(theme==='oscuro')await page.getByRole('button',{name:'Cambiar tema'}).click();
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} ${width}px ${theme} overflow`);
        }
      }
    }
    await page.goto(origin+'/clientes');
    await page.getByRole('button',{name:'Nuevo cliente',exact:true}).click();
    const sheet=page.getByRole('dialog');
    await sheet.getByLabel('Nombre o razón social').fill('Cliente guardado');
    await sheet.getByRole('button',{name:'Crear cliente',exact:true}).click();
    await sheet.waitFor({state:'hidden'});
    await page.reload();
    await page.getByText('Cliente guardado',{exact:true}).waitFor();
    assert.equal((await pool.query("SELECT count(*) FROM clientes WHERE nombre='Cliente guardado'")).rows[0].count,'1');
    await page.goto(origin+'/suplidores');
    await page.getByRole('button',{name:'Nuevo suplidor',exact:true}).click();
    await sheet.getByLabel('Nombre del suplidor').fill('Suplidor guardado');
    await sheet.getByRole('button',{name:'Crear suplidor',exact:true}).click();
    await sheet.waitFor({state:'hidden'});
    await page.reload();
    await page.getByText('Suplidor guardado',{exact:true}).waitFor();
    assert.equal((await pool.query("SELECT count(*) FROM suplidores WHERE nombre='Suplidor guardado'")).rows[0].count,'1');
    const supplierSearch=page.getByLabel('Buscar suplidor');
    await supplierSearch.fill('suplidor guardado');
    assert.equal(await page.getByText('Suplidor guardado',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText(/correo-muy-largo/).count(),0);
    await supplierSearch.fill('809-555-0000');
    assert.equal(await page.getByText(/correo-muy-largo/).isVisible(),true);
    assert.equal(await page.getByText('Suplidor guardado',{exact:true}).count(),0);
    await supplierSearch.fill('sin-coincidencias-xyz');
    await page.getByText('No hay suplidores que coincidan con la búsqueda.',{exact:true}).waitFor();
    await supplierSearch.fill('');
    await page.getByText('Suplidor guardado',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    if(server)await new Promise(done=>server.close(done));
    await pool?.end();await database?.stop();
    if(directory){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.startsWith(join(tmpdir(),'felix-paneles-')));await rm(directory,{recursive:true,force:true});}
  }
});
