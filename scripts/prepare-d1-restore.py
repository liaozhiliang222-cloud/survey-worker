"""Prepare an empty-database D1 restore with parent rows before dependent rows.

Never connects to a service or modifies the source dump. Rejects cyclic row graphs
rather than relying on deferred constraints surviving D1 import batch boundaries.
"""
from __future__ import annotations
import argparse
from graphlib import TopologicalSorter, CycleError
import json
import math
from pathlib import Path
import sqlite3


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, str):
        if '\x00' in value:
            return "CAST(X'" + value.encode('utf-8').hex() + "' AS TEXT)"
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Non-finite numeric value requires explicit handling')
    return repr(value)


def prepare(source_file, schema_file, data_file):
    source_file, schema_file, data_file = map(Path, (source_file, schema_file, data_file))
    if len({p.resolve() for p in (source_file, schema_file, data_file)}) != 3:
        raise ValueError('Source and both outputs must be different files')
    source = sqlite3.connect(':memory:')
    target = sqlite3.connect(':memory:', isolation_level=None)
    try:
        source.executescript(source_file.read_text(encoding='utf-8-sig'))
        if source.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Source backup contains broken foreign keys')
        definitions = source.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
        if any(kind == 'trigger' for kind, _, _ in definitions):
            raise ValueError('Trigger-bearing schemas require a separately reviewed restore')
        tables = {name for kind, name, _ in definitions if kind == 'table'}
        if not {'research_projects', 'd1_migrations'} <= tables:
            raise ValueError('Not a SurveyKit D1 backup')
        foreign_keys = {name: source.execute(f'PRAGMA foreign_key_list({identifier(name)})').fetchall() for name in tables}
        dependencies = {name: {fk[2] for fk in foreign_keys[name] if fk[2] != name} for name in tables}
        order = list(TopologicalSorter(dependencies).static_order())
        schemas = [sql + ';' for kind in ('table', 'index', 'view') for item_kind, _, sql in definitions if item_kind == kind]
        target.execute('PRAGMA foreign_keys=ON')
        target.executescript('\n'.join(schemas))
        statements, counts = [], {}
        for name in order:
            columns_info = source.execute(f'PRAGMA table_info({identifier(name)})').fetchall()
            columns = [r[1] for r in columns_info]
            primary_key = [r[1] for r in sorted(columns_info, key=lambda r: r[5]) if r[5]]
            rows = source.execute(f'SELECT * FROM {identifier(name)}').fetchall()
            row_dependencies = {i: set() for i in range(len(rows))}
            groups = {}
            for fk in foreign_keys[name]:
                if fk[2] == name:
                    groups.setdefault(fk[0], []).append(fk)
            for members in groups.values():
                members.sort(key=lambda r: r[1])
                source_indices = [columns.index(fk[3]) for fk in members]
                target_indices = [columns.index(fk[4] or primary_key[fk[1]]) for fk in members]
                positions = {tuple(row[j] for j in target_indices): i for i, row in enumerate(rows)}
                for i, row in enumerate(rows):
                    key = tuple(row[j] for j in source_indices)
                    if any(v is None for v in key):
                        continue
                    parent = positions[key]
                    if parent != i:
                        row_dependencies[i].add(parent)
            prefix = f'INSERT INTO {identifier(name)} ({",".join(map(identifier, columns))}) VALUES'
            for i in TopologicalSorter(row_dependencies).static_order():
                statement = prefix + '(' + ','.join(map(literal, rows[i])) + ');'
                # Check every statement in its own commit, as an import may batch.
                target.execute(statement)
                statements.append(statement)
            counts[name] = len(rows)
        if source.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone():
            statements.append('DELETE FROM sqlite_sequence;')
            for row in source.execute('SELECT name,seq FROM sqlite_sequence'):
                statements.append('INSERT INTO sqlite_sequence(name,seq) VALUES(' + ','.join(map(literal, row)) + ');')
            target.executescript('\n'.join(statements[-(1 + source.execute('SELECT count(*) FROM sqlite_sequence').fetchone()[0]):]))
        if target.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Prepared restore has broken foreign keys')
        for name in tables | {'sqlite_sequence'}:
            if not source.execute('SELECT 1 FROM sqlite_master WHERE name=?', (name,)).fetchone():
                continue
            original = source.execute(f'SELECT * FROM {identifier(name)}').fetchall()
            actual = target.execute(f'SELECT * FROM {identifier(name)}').fetchall()
            if sorted(map(repr, original)) != sorted(map(repr, actual)):
                raise ValueError(f'Prepared restore changes rows in {name}')
        schema_file.write_text('\n'.join(schemas) + '\n', encoding='utf-8')
        data_file.write_text('\n'.join(statements) + '\n', encoding='utf-8')
        return {'ok': True, 'tables': counts, 'total_rows': sum(counts.values()), 'per_statement_foreign_keys': True}
    except CycleError as exc:
        raise ValueError('Cyclic foreign keys require a transaction-aware restore; no output written') from exc
    finally:
        source.close()
        target.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('schema')
    parser.add_argument('data')
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.schema, args.data), indent=2))
