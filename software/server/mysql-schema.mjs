export const schemaVersion=1;
export const tables=['users','sessions','records','profiles','voices','practice_attempts','sign_samples','sample_number_counters','sample_numbers','video_save_keys'];
const userFk='FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE';
const recordFk='FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE';
export const definitions=[
 `users (id VARCHAR(64) PRIMARY KEY,username VARCHAR(128) NOT NULL UNIQUE,display_name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at BIGINT NOT NULL)`,
 `sessions (token_hash VARCHAR(64) PRIMARY KEY,user_id VARCHAR(64) NOT NULL,expires_at BIGINT NOT NULL,${userFk})`,
 `records (id VARCHAR(64) PRIMARY KEY,user_id VARCHAR(64) NOT NULL,kind VARCHAR(16) NOT NULL CHECK(kind IN ('text','video')),text LONGTEXT NOT NULL,media_file TEXT,mime TEXT,byte_length BIGINT NOT NULL DEFAULT 0,duration DOUBLE,created_at BIGINT NOT NULL,${userFk},INDEX records_user_time(user_id,created_at DESC))`,
 `profiles (user_id VARCHAR(64) PRIMARY KEY,email TEXT,phone TEXT,avatar_file TEXT,avatar_mime TEXT,updated_at BIGINT NOT NULL,active_voice_id TEXT,${userFk})`,
 `voices (id VARCHAR(64) PRIMARY KEY,user_id VARCHAR(64) NOT NULL,sample_file TEXT NOT NULL,ref_text LONGTEXT NOT NULL,name TEXT NOT NULL,note TEXT,duration DOUBLE NOT NULL,revision BIGINT NOT NULL DEFAULT 1,status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed')),created_at BIGINT NOT NULL,${userFk},INDEX voices_user_time(user_id,created_at DESC))`,
 `practice_attempts (id VARCHAR(64) PRIMARY KEY,record_id VARCHAR(64) NOT NULL,user_id VARCHAR(64) NOT NULL,status VARCHAR(20) NOT NULL CHECK(status IN ('candidate','uncertain','unsupported','no_hands')),candidate_id TEXT,candidate_text TEXT,snapshot LONGTEXT NOT NULL,feedback VARCHAR(16) CHECK(feedback IN ('agree','disagree','uncertain')),correction VARCHAR(400) NOT NULL DEFAULT '',revision BIGINT NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,${recordFk},${userFk},INDEX practice_record_time(record_id,created_at DESC))`,
 `sign_samples (record_id VARCHAR(64) PRIMARY KEY,user_id VARCHAR(64) NOT NULL,active INT NOT NULL DEFAULT 0,payload LONGTEXT,source_sha256 TEXT,revision BIGINT NOT NULL DEFAULT 0,updated_at BIGINT NOT NULL,${recordFk},${userFk},INDEX sign_samples_owner(user_id,active))`,
 `sample_number_counters (user_id VARCHAR(64) NOT NULL,category VARCHAR(64) NOT NULL,last_number BIGINT NOT NULL,PRIMARY KEY(user_id,category),${userFk})`,
 `sample_numbers (record_id VARCHAR(64) NOT NULL,user_id VARCHAR(64) NOT NULL,category VARCHAR(64) NOT NULL,sequence BIGINT NOT NULL,PRIMARY KEY(record_id,category),UNIQUE(user_id,category,sequence),${recordFk},${userFk})`,
 `video_save_keys (user_id VARCHAR(64) NOT NULL,save_key VARCHAR(128) NOT NULL,record_id VARCHAR(64),content_hash TEXT NOT NULL,request_hash TEXT NOT NULL,PRIMARY KEY(user_id,save_key),${userFk},FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE SET NULL)`
];
export async function initializeSchema(connection){
  for(const definition of definitions)await connection.query(`CREATE TABLE ${definition} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`);
}
