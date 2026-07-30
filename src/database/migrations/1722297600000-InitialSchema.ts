import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1722297600000 implements MigrationInterface {
  name = "InitialSchema1722297600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE programs (
        id varchar(128) PRIMARY KEY,
        currency char(3) NOT NULL,
        total_limit numeric(24,6) NOT NULL,
        reserved_amount numeric(24,6) NOT NULL DEFAULT 0,
        treasury_version bigint NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_program_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_program_total_limit CHECK (total_limit >= 0),
        CONSTRAINT chk_program_reserved_amount CHECK (reserved_amount >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE invoice_reservations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        program_id varchar(128) NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        invoice_id varchar(256) NOT NULL,
        invoice_currency char(3) NOT NULL,
        invoice_amount numeric(24,6) NOT NULL,
        fx_rate numeric(24,12) NOT NULL,
        reserved_amount numeric(24,6) NOT NULL,
        status varchar(16) NOT NULL,
        source varchar(16) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        released_at timestamptz NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_reservation_program_invoice UNIQUE (program_id, invoice_id),
        CONSTRAINT chk_reservation_currency CHECK (invoice_currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_reservation_invoice_amount CHECK (invoice_amount > 0),
        CONSTRAINT chk_reservation_fx_rate CHECK (fx_rate > 0),
        CONSTRAINT chk_reservation_reserved_amount CHECK (reserved_amount > 0),
        CONSTRAINT chk_reservation_status CHECK (status IN ('ACTIVE', 'RELEASED')),
        CONSTRAINT chk_reservation_source CHECK (source IN ('API', 'TREASURY')),
        CONSTRAINT chk_reservation_release CHECK (
          (status = 'ACTIVE' AND released_at IS NULL) OR
          (status = 'RELEASED' AND released_at IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_reservations_program_active ON invoice_reservations(program_id) WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(`
      CREATE TABLE treasury_inbox (
        event_id uuid PRIMARY KEY,
        program_id varchar(128) NOT NULL,
        event_type varchar(64) NOT NULL,
        source_version bigint NOT NULL,
        topic varchar(256) NOT NULL,
        partition integer NOT NULL,
        "offset" bigint NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_treasury_source_position UNIQUE (topic, partition, "offset")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_treasury_inbox_program_version ON treasury_inbox(program_id, source_version)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE treasury_inbox");
    await queryRunner.query("DROP TABLE invoice_reservations");
    await queryRunner.query("DROP TABLE programs");
  }
}
