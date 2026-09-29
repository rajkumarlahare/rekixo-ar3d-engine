import { useCallback, useEffect, useState } from "react";
import * as cloud from "./cloud";
import { projectSlug, type Project } from "./domain";

export type StudioCloudFilter = "active" | "archived";

export function useStudioCloudState(
  project: Project | undefined,
  onError: (message: string) => void,
) {
  const [cloudSession, setCloudSession] = useState<cloud.CloudSession>();
  const [cloudProjects, setCloudProjects] = useState<
    cloud.CloudProjectSummary[]
  >([]);
  const [cloudSearch, setCloudSearch] = useState("");
  const [cloudFilter, setCloudFilter] =
    useState<StudioCloudFilter>("active");
  const [cloudReleases, setCloudReleases] = useState<
    cloud.CloudReleaseSummary[]
  >([]);

  useEffect(() => {
    let active = true;
    void cloud
      .session()
      .then((next) => {
        if (active) setCloudSession(next);
      })
      .catch(() => {
        if (active)
          setCloudSession({
            configured: false,
            databaseReady: false,
            authenticated: false,
          });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!cloudSession?.authenticated) {
      setCloudProjects([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void cloud
        .projects(cloudSearch, cloudFilter, 50, 0)
        .then((result) => {
          if (active) setCloudProjects(result.projects);
        })
        .catch((reason: unknown) => {
          if (active)
            onError(
              reason instanceof Error
                ? reason.message
                : "Cloud projects could not be loaded.",
            );
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cloudFilter, cloudSearch, cloudSession?.authenticated, onError]);

  useEffect(() => {
    if (!cloudSession?.authenticated || !project?.cloud) {
      setCloudReleases([]);
      return;
    }
    let active = true;
    void cloud
      .releases(projectSlug(project))
      .then((result) => {
        if (active) setCloudReleases(result.releases);
      })
      .catch((reason: unknown) => {
        if (active)
          onError(
            reason instanceof Error
              ? reason.message
              : "Release history could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [
    cloudSession?.authenticated,
    project?.id,
    project?.cloud?.revision,
    onError,
  ]);

  const refreshCloudProjects = useCallback(async () => {
    if (!cloudSession?.authenticated) {
      setCloudProjects([]);
      return;
    }
    const result = await cloud.projects(cloudSearch, cloudFilter, 50, 0);
    setCloudProjects(result.projects);
  }, [cloudFilter, cloudSearch, cloudSession?.authenticated]);

  const refreshCloudReleases = useCallback(
    async (current?: Project) => {
      const target = current ?? project;
      if (!cloudSession?.authenticated || !target?.cloud) {
        setCloudReleases([]);
        return;
      }
      const result = await cloud.releases(projectSlug(target));
      setCloudReleases(result.releases);
    },
    [cloudSession?.authenticated, project],
  );

  const markCloudSignedOut = useCallback(() => {
    setCloudSession({
      configured: true,
      databaseReady: true,
      authenticated: false,
    });
    setCloudProjects([]);
    setCloudReleases([]);
  }, []);

  return {
    cloudSession,
    cloudProjects,
    cloudSearch,
    setCloudSearch,
    cloudFilter,
    setCloudFilter,
    cloudReleases,
    refreshCloudProjects,
    refreshCloudReleases,
    markCloudSignedOut,
  };
}
