const authService = require('../utils/auth');
const jwt = require('jsonwebtoken');

async function testTokenExpiry() {
    console.log('1. Checking Configured Expiry...');
    console.log('   jwtExpiry:', authService.jwtExpiry);

    console.log('\n2. Generating Token...');
    const user = { id: 'test-user', phone: '1234567890', role: 'user' };
    const token = authService.generateToken(user);

    console.log('\n3. Decoding Token...');
    const decoded = jwt.decode(token);
    console.log('   Issued At (iat):', new Date(decoded.iat * 1000).toISOString());
    console.log('   Expires At (exp):', new Date(decoded.exp * 1000).toISOString());

    const durationSeconds = decoded.exp - decoded.iat;
    console.log('   Duration (seconds):', durationSeconds);

    if (durationSeconds === 60) {
        console.log('✅ Token duration is correctly set to 60 seconds (1 minute)');
    } else {
        console.error(`❌ Token duration is ${durationSeconds} seconds (Expected 60)`);
    }

    console.log('\n4. Verifying Token immediately...');
    const verifyImmediate = authService.verifyToken(token);
    console.log('   Immediate Verification:', verifyImmediate.success ? '✅ Valid' : '❌ Invalid');

    console.log('\n5. Waiting 62 seconds to verify expiration...');
    await new Promise(resolve => setTimeout(resolve, 62000));

    const verifyExpired = authService.verifyToken(token);
    console.log('   Expired Verification:', verifyExpired.success ? '❌ Still Valid (Unexpected)' : '✅ Invalid (Expected)');
}

testTokenExpiry();
