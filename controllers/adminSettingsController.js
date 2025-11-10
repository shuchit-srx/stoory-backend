const { supabaseAdmin } = require('../supabase/client');
const crypto = require('crypto');

// In-memory cache (process lifetime)
let cachedSettings = null; // { data, etag, lastModified }
const SETTINGS_KEY = 'system';

function computeETag(payload) {
	return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function validateSettings(input) {
	const errors = {};

	if (input.commission_rate_pct !== undefined) {
		if (typeof input.commission_rate_pct !== 'number' || input.commission_rate_pct < 0 || input.commission_rate_pct > 100) {
			errors.commission_rate_pct = 'Must be between 0 and 100';
		}
	}

	if (input.min_payout_amount !== undefined) {
		if (typeof input.min_payout_amount !== 'number' || input.min_payout_amount < 0) {
			errors.min_payout_amount = 'Must be a number >= 0';
		}
	}

	if (input.currency !== undefined) {
		if (typeof input.currency !== 'string' || input.currency.length !== 3) {
			errors.currency = 'Must be ISO 4217 (e.g., "INR")';
		}
	}

	if (input.maintenance_mode !== undefined && typeof input.maintenance_mode !== 'boolean') {
		errors.maintenance_mode = 'Must be boolean';
	}

	if (input.payout_thresholds !== undefined) {
		if (typeof input.payout_thresholds !== 'object' || input.payout_thresholds === null) {
			errors.payout_thresholds = 'Must be an object';
		} else if (input.payout_thresholds.influencer !== undefined) {
			if (typeof input.payout_thresholds.influencer !== 'number' || input.payout_thresholds.influencer < 0) {
				errors['payout_thresholds.influencer'] = 'Must be a number >= 0';
			}
		}
	}

	if (input.features !== undefined) {
		if (typeof input.features !== 'object' || input.features === null) {
			errors.features = 'Must be an object';
		} else {
			['escrow', 'wallets'].forEach((k) => {
				if (input.features[k] !== undefined && typeof input.features[k] !== 'boolean') {
					errors[`features.${k}`] = 'Must be boolean';
				}
			});
		}
	}

	return { valid: Object.keys(errors).length === 0, errors };
}

async function readCommissionSettings() {
	// Read from existing commission_settings table for backward compatibility
	const { data, error } = await supabaseAdmin
		.from('commission_settings')
		.select('*')
		.eq('is_active', true)
		.order('effective_from', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error && error.code !== 'PGRST116') {
		console.warn('Error reading commission settings:', error);
		return null;
	}
	return data;
}

async function readSettingsFromDB() {
	// Expect table: system_settings { id text pk, data jsonb, updated_at timestamptz, updated_by text, version int }
	const { data, error } = await supabaseAdmin
		.from('system_settings')
		.select('*')
		.eq('id', SETTINGS_KEY)
		.maybeSingle();

	if (error && error.code !== 'PGRST116') throw error;
	return data;
}

async function upsertSettingsToDB(payload, updatedBy = null) {
	const now = new Date().toISOString();
	const row = {
		id: SETTINGS_KEY,
		data: payload,
		updated_at: now,
		updated_by: updatedBy,
	};
	const { data, error } = await supabaseAdmin
		.from('system_settings')
		.upsert(row)
		.select('*')
		.single();
	if (error) throw error;
	return data;
}

async function writeAuditLog(oldData, newData, user, ip) {
	try {
		await supabaseAdmin.from('system_settings_audit').insert({
			settings_id: SETTINGS_KEY,
			old_data: oldData || {},
			new_data: newData || {},
			updated_by: user?.id || user?.email || 'unknown',
			updated_by_email: user?.email || null,
			ip_address: ip || null,
		});
	} catch (e) {
		// best-effort; do not block
		console.warn('Audit log insert failed:', e?.message || e);
	}
}

class AdminSettingsController {
	async getSystemSettings(req, res) {
		try {
			// Conditional GET using If-None-Match/If-Modified-Since
			if (cachedSettings) {
				const inm = req.headers['if-none-match'];
				const ims = req.headers['if-modified-since'];
				if ((inm && inm === cachedSettings.etag) || (ims && ims === cachedSettings.lastModified)) {
					res.status(304).end();
					return;
				}
			}

			// Read from both system_settings and commission_settings
			const [dbRow, commissionData] = await Promise.all([
				readSettingsFromDB(),
				readCommissionSettings()
			]);

			// Default commission from commission_settings table (for backward compatibility)
			const defaultCommission = commissionData?.commission_percentage || 10.0;

			const defaults = {
				commission_rate_pct: defaultCommission,
				min_payout_amount: 0,
				maintenance_mode: false,
				currency: 'INR',
				payout_thresholds: { influencer: 0 },
				features: { escrow: false, wallets: true },
			};

			// Merge: system_settings overrides defaults, but commission_settings takes precedence if not in system_settings
			const snapshot = dbRow?.data 
				? { 
					...defaults, 
					...dbRow.data,
					// If commission_rate_pct not in system_settings, use commission_settings
					commission_rate_pct: dbRow.data.commission_rate_pct !== undefined 
						? dbRow.data.commission_rate_pct 
						: defaultCommission
				} 
				: defaults;

			const payload = {
				success: true,
				data: {
					...snapshot,
					updated_at: dbRow?.updated_at || null,
					updated_by: dbRow?.updated_by || null,
				},
			};

			const etag = computeETag(payload.data);
			const lastModified = dbRow?.updated_at || new Date().toISOString();
			cachedSettings = { data: payload.data, etag, lastModified };

			res.setHeader('ETag', etag);
			res.setHeader('Last-Modified', lastModified);
			return res.json(payload);
		} catch (error) {
			return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
		}
	}

	async updateSystemSettings(req, res) {
		try {
			const body = req.body || {};
			const { valid, errors } = validateSettings(body);
			if (!valid) {
				return res.status(400).json({ success: false, message: 'Validation error', errors });
			}

			// Load current from both sources
			const [dbRow, commissionData] = await Promise.all([
				readSettingsFromDB(),
				readCommissionSettings()
			]);

			const defaultCommission = commissionData?.commission_percentage || 10.0;
			const defaults = {
				commission_rate_pct: defaultCommission,
				min_payout_amount: 0,
				maintenance_mode: false,
				currency: 'INR',
				payout_thresholds: { influencer: 0 },
				features: { escrow: false, wallets: true },
			};
			const current = dbRow?.data 
				? { 
					...defaults, 
					...dbRow.data,
					commission_rate_pct: dbRow.data.commission_rate_pct !== undefined 
						? dbRow.data.commission_rate_pct 
						: defaultCommission
				} 
				: defaults;

			const updated = {
				...current,
				...body,
				payout_thresholds: body.payout_thresholds
					? { ...current.payout_thresholds, ...body.payout_thresholds }
					: current.payout_thresholds,
				features: body.features
					? { ...current.features, ...body.features }
					: current.features,
			};

			// If commission_rate_pct is being updated, sync to commission_settings table for backward compatibility
			// This ensures the active commission setting always matches system_settings
			if (body.commission_rate_pct !== undefined) {
				try {
					// Deactivate all current active settings
					await supabaseAdmin
						.from('commission_settings')
						.update({ is_active: false })
						.eq('is_active', true);

					// Create new active commission setting with the updated value
					await supabaseAdmin
						.from('commission_settings')
						.insert({
							commission_percentage: updated.commission_rate_pct,
							is_active: true,
							effective_from: new Date().toISOString()
						});
				} catch (commError) {
					console.warn('Failed to sync commission_settings table:', commError);
					// Continue anyway - system_settings is the source of truth
				}
			}

			const saved = await upsertSettingsToDB(updated, req.user?.id || null);

			// best-effort audit
			await writeAuditLog(current, updated, req.user, req.ip);

			// Update cache
			const payload = {
				success: true,
				data: {
					...updated,
					updated_at: saved?.updated_at || new Date().toISOString(),
					updated_by: req.user?.id || null,
				},
			};
			const etag = computeETag(payload.data);
			const lastModified = payload.data.updated_at;
			cachedSettings = { data: payload.data, etag, lastModified };

			res.setHeader('ETag', etag);
			res.setHeader('Last-Modified', lastModified);
			return res.json(payload);
		} catch (error) {
			return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
		}
	}

	// Optional: audit listing
	async getAudit(req, res) {
		try {
			const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
			const { data, error } = await supabaseAdmin
				.from('system_settings_audit')
				.select('*')
				.eq('settings_id', SETTINGS_KEY)
				.order('created_at', { ascending: false })
				.limit(limit);
			if (error) throw error;
			return res.json({ success: true, data: data || [] });
		} catch (e) {
			return res.status(500).json({ success: false, message: 'Internal server error', error: e.message });
		}
	}

	// Optional: simulate maintenance (non-prod)
	async testMaintenance(req, res) {
		try {
			if ((process.env.NODE_ENV || 'development') === 'production') {
				return res.status(403).json({ success: false, message: 'Not allowed in production' });
			}
			setTimeout(() => {}, 0); // no-op placeholder
			return res.json({ success: true, message: 'Maintenance simulation accepted (client-side should gate UI for 60s)' });
		} catch (e) {
			return res.status(500).json({ success: false, message: 'Internal server error', error: e.message });
		}
	}
}

module.exports = new AdminSettingsController();
