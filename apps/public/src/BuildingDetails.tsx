import { useState } from "react";
import type { ClientExperience } from "./api";
import { presentationAssetBase } from "./viewer/sourcePresentation";
import { buildingPresentation, contactLinks, exactMapLinks, publishedMediaUrl } from "./clientPresentation";

export function BuildingDetails({ experience }: { experience: ClientExperience }) {
  const settings = buildingPresentation(experience);
  const maps = exactMapLinks(settings.location);
  const contact = contactLinks(settings.contact);
  const [failedMedia, setFailedMedia] = useState<string[]>([]);
  const sourceGallery = experience.sourcePresentation?.gallery?.filter((item) => /^[a-z0-9-]+\.webp$/.test(item.asset) && typeof item.caption === "string").map((item) => ({ mediaKey: item.asset, caption: item.caption })) ?? [];
  const galleryBase = sourceGallery.length && experience.sourcePresentation ? presentationAssetBase(experience.sourcePresentation) : experience.mediaBaseUrl;
  const galleryItems = sourceGallery.length ? sourceGallery : settings.gallery;
  const gallery = Array.isArray(galleryItems) ? galleryItems.filter((item) => item && typeof item.caption === "string" && typeof item.mediaKey === "string" && !failedMedia.includes(item.mediaKey) && publishedMediaUrl(galleryBase, item.mediaKey)) : [];
  const address = settings.location?.address || experience.project.location;
  return <>
    {address && <section className="client-location-card" aria-label="Project location">
      <div><span>PROJECT LOCATION</span><strong>{address}</strong>

      </div>
      {maps ? <a href={maps.open} target="_blank" rel="noopener noreferrer">Open in Maps ↗</a> : <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer">View locality in Maps ↗</a>}
    </section>}
    {maps && <iframe className="client-map" title={`${experience.project.name} location map`} src={maps.embed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
    {gallery.length > 0 && <section className="client-gallery" aria-label="Project gallery">
      <h2>Project gallery</h2><div>{gallery.map((item) => <figure key={item.mediaKey}>
        <img src={publishedMediaUrl(galleryBase, item.mediaKey)} alt={item.caption} loading="lazy" onError={() => setFailedMedia((items) => [...items, item.mediaKey])} />
        <figcaption>{item.caption}</figcaption>
      </figure>)}</div>
    </section>}
    {(contact.phone || contact.email) && <section id="project-enquiry" className="client-enquiry">
      <div><span>ENQUIRIES</span><h2>{settings.contact?.label || "Discover more about this project"}</h2></div>
      {contact.phone && <a href={contact.phone}>Call for details</a>}
      {contact.email && <a href={contact.email}>Email enquiry</a>}
    </section>}
  </>;
}
