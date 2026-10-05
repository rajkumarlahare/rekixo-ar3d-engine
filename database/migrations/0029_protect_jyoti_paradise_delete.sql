-- Jyoti Paradise is the locked production benchmark during the AR3D engine cleanup.
-- This is deliberately narrow: it blocks deleting the project row, but does not
-- freeze normal read/runtime behavior or future release activation by itself.

CREATE TRIGGER IF NOT EXISTS trg_projects_3d_protect_jyoti_paradise_delete
BEFORE DELETE ON projects_3d
FOR EACH ROW
WHEN OLD.slug = 'jyoti-paradise'
BEGIN
  SELECT RAISE(
    ABORT,
    'Jyoti Paradise is a locked production project and cannot be deleted'
  );
END;
