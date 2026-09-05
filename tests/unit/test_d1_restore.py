from pathlib import Path
import importlib.util
import sqlite3

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('prepare_d1_restore', ROOT / 'scripts/prepare-d1-restore.py')
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)

# Mirrors the observed D1 export failure: child table/data precedes its parent,
# and a weighted dataset precedes its own raw parent.
SOURCE = """
CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE);
INSERT INTO d1_migrations VALUES(7,'fixture');
CREATE TABLE research_datasets(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES research_datasets(id),file_id TEXT REFERENCES research_project_files(id));
INSERT INTO research_datasets VALUES('weighted','raw','file');
INSERT INTO research_datasets VALUES('raw',NULL,'file');
CREATE TABLE research_project_files(id TEXT PRIMARY KEY,project_id TEXT REFERENCES research_projects(id));
INSERT INTO research_project_files VALUES('file','project');
CREATE TABLE research_projects(id TEXT PRIMARY KEY,title TEXT,attachment BLOB);
INSERT INTO research_projects VALUES('project',CAST(X'6127623b000a63' AS TEXT),X'0001ff');
"""


def test_empty_restore_orders_tables_and_self_references(tmp_path):
    raw = tmp_path / 'source.sql'
    raw.write_text(SOURCE, encoding='utf-8')
    schema, data = tmp_path / 'schema.sql', tmp_path / 'data.sql'
    with sqlite3.connect(':memory:') as naive:
        naive.execute('PRAGMA foreign_keys=ON')
        with pytest.raises(sqlite3.OperationalError, match='no such table'):
            naive.executescript(SOURCE)
    report = restore.prepare(raw, schema, data)
    assert report['per_statement_foreign_keys'] is True
    with sqlite3.connect(':memory:', isolation_level=None) as target:
        target.execute('PRAGMA foreign_keys=ON')
        target.executescript(schema.read_text(encoding='utf-8'))
        target.executescript(data.read_text(encoding='utf-8'))
        assert target.execute('PRAGMA foreign_key_check').fetchall() == []
        assert target.execute("SELECT parent_id FROM research_datasets WHERE id='weighted'").fetchone() == ('raw',)
        assert target.execute('SELECT title,attachment FROM research_projects').fetchone() == ("a'b;\x00\nc", b'\x00\x01\xff')
        assert target.execute('SELECT seq FROM sqlite_sequence WHERE name=?', ('d1_migrations',)).fetchone() == (7,)


@pytest.mark.parametrize('source,message', [
    (SOURCE.replace("'weighted','raw','file'", "'weighted','missing','file'"), 'broken foreign keys'),
    (SOURCE.replace("'raw',NULL,'file'", "'raw','weighted','file'"), 'Cyclic foreign keys'),
])
def test_invalid_or_cyclic_backup_produces_no_restore_files(tmp_path, source, message):
    raw = tmp_path / 'source.sql'
    raw.write_text(source, encoding='utf-8')
    schema, data = tmp_path / 'schema.sql', tmp_path / 'data.sql'
    with pytest.raises(ValueError, match=message):
        restore.prepare(raw, schema, data)
    assert not schema.exists()
    assert not data.exists()


def test_source_cannot_be_overwritten(tmp_path):
    raw = tmp_path / 'source.sql'
    raw.write_text(SOURCE, encoding='utf-8')
    with pytest.raises(ValueError, match='different files'):
        restore.prepare(raw, raw, tmp_path / 'data.sql')
    assert raw.read_text(encoding='utf-8') == SOURCE
