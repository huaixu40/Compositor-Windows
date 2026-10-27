const esbuild=require('esbuild');
Promise.all([
  esbuild.build({entryPoints:['src/app.js'],bundle:true,outfile:'dist/app.js',loader:{'.wgsl':'text'}}),
  esbuild.build({entryPoints:['src/jobs/worker.js'],bundle:true,outfile:'dist/worker.js'})
]).catch(error=>{console.error(error);process.exitCode=1;});
