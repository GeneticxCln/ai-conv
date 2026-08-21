import { migrate } from './db';

console.log('Running migrations...');
migrate();
console.log('Migrations complete.');
