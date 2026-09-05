// Tiny deterministic orthographic rasterizer for source/runtime visual comparisons.
// Input: uint32 width,height,vertices,indexCount,textureWidth,textureHeight;
// float32 vertices [screenX,screenY,depth,light,u,v], uint32 indices, RGBA texture.
// Output: RGBA; alpha=0 background. It is a CPU base-map view, not browser PBR QA.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <vector>
#include <limits>
int main(int argc, char** argv) {
  if (argc != 3) return 1;
  std::ifstream input(argv[1], std::ios::binary);
  uint32_t header[6]; input.read((char*)header, sizeof header);
  const auto [w,h,n,ic,tw,th] = *reinterpret_cast<std::array<uint32_t,6>*>(header);
  std::vector<float> verts(n*6), depth(w*h, -std::numeric_limits<float>::infinity());
  std::vector<uint32_t> indices(ic);
  std::vector<uint8_t> texture(tw*th*4), output(w*h*4,0);
  input.read((char*)verts.data(), verts.size()*sizeof(float));
  input.read((char*)indices.data(), indices.size()*sizeof(uint32_t));
  input.read((char*)texture.data(), texture.size());
  for (size_t k=0; k<ic; k+=3) {
    const float *a=&verts[indices[k]*6], *b=&verts[indices[k+1]*6], *c=&verts[indices[k+2]*6];
    float det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if (std::abs(det)<1e-8f) continue;
    int minx=std::max(0,(int)std::floor(std::min({a[0],b[0],c[0]})));
    int maxx=std::min((int)w-1,(int)std::ceil(std::max({a[0],b[0],c[0]})));
    int miny=std::max(0,(int)std::floor(std::min({a[1],b[1],c[1]})));
    int maxy=std::min((int)h-1,(int)std::ceil(std::max({a[1],b[1],c[1]})));
    for(int y=miny;y<=maxy;y++) for(int x=minx;x<=maxx;x++) {
      float p=((b[1]-c[1])*(x+.5f-c[0])+(c[0]-b[0])*(y+.5f-c[1]))/det;
      float q=((c[1]-a[1])*(x+.5f-c[0])+(a[0]-c[0])*(y+.5f-c[1]))/det, r=1-p-q;
      if(p<0 || q<0 || r<0) continue;
      float z=a[2]*p+b[2]*q+c[2]*r;
      const int offset=y*w+x;
      if(z<=depth[offset]) continue;
      depth[offset]=z;
      float light=std::clamp(a[3]*p+b[3]*q+c[3]*r,0.f,1.f);
      float u=std::clamp(a[4]*p+b[4]*q+c[4]*r,0.f,1.f)*(tw-1);
      float v=std::clamp(a[5]*p+b[5]*q+c[5]*r,0.f,1.f)*(th-1);
      int u0=(int)u,v0=(int)v,u1=std::min(u0+1,(int)tw-1),v1=std::min(v0+1,(int)th-1);
      float fu=u-u0,fv=v-v0;
      for(int channel=0;channel<3;channel++) {
        float top=texture[(v0*tw+u0)*4+channel]*(1-fu)+texture[(v0*tw+u1)*4+channel]*fu;
        float bottom=texture[(v1*tw+u0)*4+channel]*(1-fu)+texture[(v1*tw+u1)*4+channel]*fu;
        output[offset*4+channel]=(uint8_t)std::clamp((top*(1-fv)+bottom*fv)*light,0.f,255.f);
      }
      output[offset*4+3]=255;
    }
  }
  std::ofstream file(argv[2],std::ios::binary); file.write((char*)output.data(),output.size());
}
