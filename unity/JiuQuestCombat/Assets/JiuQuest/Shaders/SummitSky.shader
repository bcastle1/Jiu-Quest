Shader "JiuQuest/Summit Sky"
{
    SubShader
    {
        Tags { "Queue"="Background" "RenderType"="Background" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Cull Front ZWrite Off ZTest LEqual
            HLSLPROGRAM
            #pragma vertex SkyVertex
            #pragma fragment SkyFragment
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD0; };
            Varyings SkyVertex(Attributes input)
            {
                Varyings output;
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                return output;
            }
            half4 SkyFragment(Varyings input) : SV_Target
            {
                float3 ray = normalize(input.positionWS - GetCameraPositionWS());
                float elevation = saturate(ray.y);
                half3 sky = lerp(half3(.26,.40,.48), half3(.035,.115,.225), pow(elevation, .50));
                float azimuth = atan2(ray.z, ray.x);
                float streak = sin(elevation * 95 + sin(azimuth * 2.3) * 2.5) * .5 + .5;
                float breakup = sin(azimuth * 5 + sin(azimuth * 2)) * .5 + .5;
                float cloudBand = smoothstep(.025,.08,elevation) * (1-smoothstep(.20,.36,elevation));
                float cloud = smoothstep(.48,.94,streak) * smoothstep(.20,.65,breakup) * cloudBand * .32;
                sky = lerp(sky, half3(.64,.69,.67), cloud);
                float sun = saturate(dot(ray, normalize(float3(-.40,.28,-.86))));
                sky += half3(.26,.14,.05) * pow(sun, 32);
                sky = lerp(sky, half3(1,.86,.60), smoothstep(.99935,.9998,sun));
                return half4(sky, 1);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
